// Shared wire protocol supported by Codex and Claude Code. No model calls, test runs or installs.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { readSession, sessionPath } from '../core/plugin-session.mjs'
import { readGoal, goalStatus, renderGoal, recordPrompt } from '../core/goal.mjs'

export function hookResponse(input, { root, session, next, cli, work = null, goal = null }) {
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
  ]
  // The owner's goal first: what every session is for. Its status is what the hook observed.
  if (event === 'SessionStart' && goal) context.push(goal)
  // Recorded work state is context for continuing, never completion evidence.
  if (event === 'SessionStart' && work?.text) context.push(`Recorded work state (gatectl work brief; context, not evidence):\n${work.text}`)
  else if (event === 'SessionStart' && work?.unavailable) context.push(`gatectl work state unavailable: ${work.unavailable}`)
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context.join('\n') } }
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
      const r = spawnSync(process.execPath, [cliFile, 'next', '--recorded-completion', '--json', '--target', root], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
      try { next = r.status === 0 ? JSON.parse(r.stdout) : null } catch { /* no answer is not approval */ }
    }
  }
  // What the owner actually said is recorded before anything else can fail; it is how a later
  // "the owner confirmed" is checked. Recording never fails the hook.
  if (input.hook_event_name === 'UserPromptSubmit' && typeof input.prompt === 'string') {
    try { recordPrompt(root, { text: input.prompt, session: typeof input.session_id === 'string' ? input.session_id : null, at: new Date().toISOString() }) }
    catch { /* observation is best effort */ }
  }
  let goal = null
  if (input.hook_event_name === 'SessionStart') {
    try { const g = readGoal(root); if (g) goal = renderGoal(goalStatus(root, g)).slice(0, 1200) }
    catch (e) { goal = `gatectl owner goal unavailable: ${e.message.split('\n')[0].slice(0, 200)}` }
  }
  const work = input.hook_event_name === 'SessionStart' ? workBrief(root, cliFile) : null
  const response = hookResponse(input, { root, session, next, work, goal, cli: `node ${JSON.stringify(cliFile)}` })
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

// The brief runs in its own process: node:sqlite may need a flag there, and a slow or locked store
// must cost at most its timeout, never the session. Only SessionStart reads it; Stop never does.
const BRIEF_LIMIT = 2000
function workBrief(root, cliFile) {
  // The flag is passed up front (where this Node knows it) so the brief never re-executes itself:
  // a grandchild would outlive the timeout.
  const flags = process.allowedNodeEnvironmentFlags.has('--experimental-sqlite') ? ['--experimental-sqlite', '--disable-warning=ExperimentalWarning'] : []
  const r = spawnSync(process.execPath, [...flags, cliFile, 'work', 'brief', '--without-owner-goal', '--max-chars', String(BRIEF_LIMIT), '--target', root],
    { cwd: root, encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024, env: { ...process.env, GATECTL_WORK_REEXEC: '1' } })
  if (r.error || r.status !== 0) {
    const why = r.error?.code === 'ETIMEDOUT' ? 'timed out' : (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`
    return { unavailable: why.slice(0, 300) }
  }
  const text = r.stdout.trim()
  return text ? { text: text.slice(0, BRIEF_LIMIT) } : null
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
