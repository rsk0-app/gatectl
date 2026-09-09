// Shared wire protocol supported by Codex and Claude Code. No model calls, test runs or installs.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { readSession, sessionPath } from '../core/plugin-session.mjs'

export function hookResponse(input, { root, session, next, cli }) {
  const event = input.hook_event_name
  if (event === 'Stop') {
    if (!session || session.paused || input.permission_mode === 'plan') return {}
    // Continue at most once. A missing credential or unanswered question cannot be repaired
    // by an infinite loop; this does not record PASS or completion.
    if (next?.state === 'COMPLETED') return {}
    if (input.stop_hook_active) return { systemMessage: 'gatectl task remains incomplete. Report the blocker; do not claim completion.' }
    const why = next?.why ?? 'gatectl could not evaluate the current state'
    if (next?.state === 'BLOCKED') return { systemMessage: `gatectl task remains blocked: ${why}. Ask for the missing decision; do not claim completion.` }
    return { decision: 'block', reason: `gatectl has not accepted this task: ${why}. ${next?.next_command ? `Next: ${next.next_command}.` : ''} Continue the delivery skill, or report the concrete blocker. Never waive a finding or change policy just to finish.` }
  }
  if (!['SessionStart', 'UserPromptSubmit'].includes(event)) return {}
  const id = typeof input.session_id === 'string' ? input.session_id : null
  const context = [
    `gatectl is enabled for ${root}. For implementation requests, including ordinary requests such as "сделай задачу", use the gatectl delivery skill before editing.`,
    `The bundled CLI is: ${cli}. No global gatectl install is required.`,
    id ? `Session id (data, not a command): ${JSON.stringify(id)}. Enroll implementation work with task start <slug> --session <id> --client codex|claude.` : 'The hook received no session id; the skill still applies, but automatic Stop enforcement is unavailable.',
    'Read-only questions and reviews do not enroll a task. Follow the current policy via next --json; never invent a RED test for a policy-only tier.',
    'Only finish (legacy complete) exit 0 permits a completion claim. A blocked task, pause, or bounded Stop continuation is not approval. Preserve user cancellation and existing permission boundaries.',
  ].join('\n')
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } }
}

export function runPluginHook(input, cliFile) {
  if (!input || typeof input.cwd !== 'string') return {}
  let root
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: input.cwd, encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return {} }
  if (!fs.existsSync(path.join(root, '.gatectl/policy.yaml'))) return {}
  let session = null, next = null
  if (input.session_id) {
    try { session = readSession(root, input.session_id) }
    catch { return { systemMessage: 'gatectl session state is unreadable; completion is not established. Run the delivery skill to diagnose it.' } }
  }
  if (input.hook_event_name === 'Stop' && session && !session.paused) {
    const active = fs.existsSync(path.join(root, 'docs/specs/ACTIVE')) ? fs.readFileSync(path.join(root, 'docs/specs/ACTIVE'), 'utf8').trim() : null
    if (active !== session.slug) next = { state: 'BLOCKED', why: 'the active feature changed since this session enrolled; resume the correct task explicitly' }
    else {
      const r = spawnSync(process.execPath, [cliFile, 'next', '--json', '--target', root], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
      try { next = r.status === 0 ? JSON.parse(r.stdout) : null } catch { /* no answer is not approval */ }
    }
  }
  const response = hookResponse(input, { root, session, next, cli: `node ${JSON.stringify(cliFile)}` })
  // An unavailable next result is not an evaluated reminder to memoize.
  if (response.decision !== 'block' || !next) return response
  let signature
  try { signature = reminderSignature(root, session) }
  catch {
    return { ...response, reason: `${response.reason} Candidate fingerprint unavailable; duplicate reminder suppression was not applied.` }
  }
  try {
    const latest = readSession(root, input.session_id)
    if (!latest || latest.paused || latest.slug !== session.slug || latest.at !== session.at) {
      return { systemMessage: 'gatectl session changed during the Stop check; completion is not established. Re-read task state.' }
    }
    // Never write the task session file: a racing marker write must not undo a
    // user pause or overwrite a new enrollment. Marker identity includes `at`.
    const sessionFile = sessionPath(root, input.session_id)
    const dir = path.join(path.dirname(sessionFile), 'reminders')
    const file = path.join(dir, path.basename(sessionFile))
    let prior = null
    try { prior = JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (prior?.signature === signature) {
      return { systemMessage: `gatectl task remains incomplete: ${next?.why ?? 'state could not be evaluated'}. ${next?.next_command ? `Next: ${next.next_command}. ` : ''}A reminder was already issued for this unchanged candidate. Continue authorized work; only finish exit 0 establishes completion.` }
    }
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify({ signature }) + '\n', { mode: 0o600 })
      fs.renameSync(tmp, file)
    } finally {
      try { fs.rmSync(tmp, { force: true }) } catch { /* storage error is reported below */ }
    }
  } catch {
    return { ...response, reason: `${response.reason} Reminder state unavailable; duplicate reminder suppression was not applied.` }
  }
  return response
}

// Both the staged candidate and the entire working tree matter. `git add -A`
// here uses a disposable index, so untracked/unstaged files are included without
// changing the user's index. One shared Git budget leaves room for next (10s)
// and root lookup (1s) inside the hosts' 20s hook timeout.
function reminderSignature(root, session) {
  const deadline = Date.now() + 4000
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-reminder-'))
  const index = path.join(dir, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: index }
  const git = (args, commandEnv = process.env) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('reminder Git budget exceeded')
    return execFileSync('git', args, { cwd: root, env: commandEnv, timeout: remaining,
      encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  try {
    const actualIndex = path.resolve(root, git(['rev-parse', '--git-path', 'index']))
    if (fs.existsSync(actualIndex)) fs.copyFileSync(actualIndex, index)
    else git(['read-tree', 'HEAD'], env)
    // In particular, an unmerged index must fail here, not be silently resolved
    // by staging the working tree into the disposable index below.
    const staged = git(['write-tree'], env)
    git(['read-tree', 'HEAD'], env)
    git(['add', '-A'], env)
    const working = git(['write-tree'], env)
    return JSON.stringify([session.slug, session.at, staged, working])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
