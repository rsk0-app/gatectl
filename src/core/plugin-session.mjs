// Session enrollment controls hook reminders only. It is never evidence for a gate.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { stateDir } from './authority.mjs'
export function sessionPath(root, id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new Error('a non-empty session id (at most 256 characters) is required')
  return path.join(stateDir(root), 'sessions', crypto.createHash('sha256').update(id).digest('hex') + '.json')
}
export function readSession(root, id) {
  const file = sessionPath(root, id)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}
export function writeSession(root, id, value) {
  const file = sessionPath(root, id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}
export function clientFamily(model) {
  if (/claude|anthropic/i.test(model ?? '')) return 'claude'
  if (/codex|openai|gpt|^o[134](?:-|$)/i.test(model ?? '')) return 'codex'
  return null
}
