// Shared wire protocol supported by Codex and Claude Code. No model calls, test runs or installs.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { readSession } from '../core/plugin-session.mjs'

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
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
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
      const r = spawnSync(process.execPath, [cliFile, 'next', '--json', '--target', root], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
      try { next = r.status === 0 ? JSON.parse(r.stdout) : null } catch { /* no answer is not approval */ }
    }
  }
  return hookResponse(input, { root, session, next, cli: `node ${JSON.stringify(cliFile)}` })
}
