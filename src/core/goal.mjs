// src/core/goal.mjs — the owner's goal, and what gatectl actually saw the owner say about it.
//
// The goal is an agreed requirement, so it lives in the repository (docs/goal.yaml). What it cannot
// carry on its own word is "the owner confirmed this": an agent can write that line as easily as any
// other, and once did. So confirmation is tied to two things the goal file does not control: an id
// that is the full digest of the agreed content, and a dedicated message naming that id which the
// UserPromptSubmit hook saw the owner send. "Observed by the gatectl hook" is the whole claim — it
// is not cryptographic proof, and every place that reports it says so.
//
// Context, never evidence: no gate reads this module (test/owner-goal.test.mjs).
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import yaml from "js-yaml"
import { stateDir } from "./authority.mjs"

export const GOAL_FILE = "docs/goal.yaml"
const PROMPT_LIMIT = 200
const TEXT_LIMIT = 4000

export class GoalError extends Error {
  constructor(code, message, exit = 2) {
    super(`${code}: ${message}`)
    this.code = code
    this.exit = exit
  }
}

// Resolving the state directory asks git; once per repository and state root is enough.
const dirs = new Map()
const dirOf = (root, env) => {
  const key = `${root}\0${env.GATECTL_STATE_DIR ?? ""}\0${env.HOME ?? ""}`
  if (!dirs.has(key)) dirs.set(key, stateDir(root, env))
  return dirs.get(key)
}
const promptsFile = (root, env) => path.join(dirOf(root, env), "owner-prompts.jsonl")
const confirmationsFile = (root, env) => path.join(dirOf(root, env), "owner-confirmations.jsonl")

// The full digest, always. A short prefix is for reading; a prefix an agent could search a
// collision for is not something a confirmation may bind to.
export function goalId(g) {
  const agreed = { owner_words: g.owner_words ?? [], goal: g.goal ?? "", success: g.success ?? [], out_of_scope: g.out_of_scope ?? [] }
  return `G-${crypto.createHash("sha256").update(JSON.stringify(agreed)).digest("hex")}`
}

// The whole message must be the confirmation — "я не подтверждаю цель G-…" contains the words and
// means the opposite.
const CONFIRM = /^(?:подтверждаю цель|confirm goal) g-([0-9a-f]{64})$/
export function confirmationIn(text) {
  const normalized = String(text).trim().toLowerCase().replace(/\s+/g, " ").replace(/[\s.!…]+$/u, "")
  const hex = CONFIRM.exec(normalized)?.[1]
  return hex ? `G-${hex}` : null
}

function appendLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  // O_APPEND: concurrent hooks each land a whole line; nothing is read-modify-written here.
  const fd = fs.openSync(file, "a", 0o600)
  try { fs.writeSync(fd, JSON.stringify(value) + "\n") } finally { fs.closeSync(fd) }
}

function readLines(file) {
  let text
  try { text = fs.readFileSync(file, "utf8") } catch { return [] }
  return text.split("\n").flatMap((line) => { try { return line ? [JSON.parse(line)] : [] } catch { return [] } })
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Keeps at most PROMPT_LIMIT prompts across two generations: the live file and `.1`. Rotation is a
// single rename of the live file to `.1`, so nothing is copied and nothing appended concurrently is
// lost — a writer that opened the file before the rename writes into `.1`, one that opens after
// creates a new live file. The lock only stops two rotations racing; it is skipped when busy. The
// confirmation log is never rotated.
const GENERATION = PROMPT_LIMIT / 2
function rotate(file) {
  const count = () => { try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length } catch { return 0 } }
  if (count() < GENERATION) return
  const lock = `${file}.lock`
  for (let tries = 0; ; tries++) {
    try { fs.mkdirSync(lock); break } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { recursive: true, force: true }) } catch { /* gone */ }
      if (tries >= 20) return
      sleep(10)
    }
  }
  try { if (count() >= GENERATION) fs.renameSync(file, `${file}.1`) }
  finally { fs.rmSync(lock, { recursive: true, force: true }) }
}
// What counts as observed is the last PROMPT_LIMIT entries across both generations. Under heavy
// lock contention a generation can briefly hold more on disk (trimming it in place would reopen the
// lost-append race); the excess is never read and leaves with the next rename.
const readPrompts = (root, env) =>
  [...readLines(`${promptsFile(root, env)}.1`), ...readLines(promptsFile(root, env))].slice(-PROMPT_LIMIT)

export function recordPrompt(root, { text, session, at }, env = process.env) {
  const value = String(text ?? "")
  const entry = { at, session: session ?? null, text: value.slice(0, TEXT_LIMIT) }
  if (value.length > TEXT_LIMIT) entry.truncated = true
  appendLine(promptsFile(root, env), entry)
  const id = confirmationIn(value)
  if (id) appendLine(confirmationsFile(root, env), { id, at, session: session ?? null })
  rotate(promptsFile(root, env))
}

export function readGoal(root) {
  const file = path.join(root, GOAL_FILE)
  if (!fs.existsSync(file)) return null
  let g
  try { g = yaml.load(fs.readFileSync(file, "utf8")) } catch (e) { throw new GoalError("GOAL_INVALID", `${GOAL_FILE} is not valid YAML: ${e.message.split("\n")[0]}`) }
  const list = (v) => Array.isArray(v) && v.every((x) => typeof x === "string")
  if (!g || typeof g.goal !== "string" || !list(g.owner_words) || !list(g.success ?? []) || !list(g.out_of_scope ?? []))
    throw new GoalError("GOAL_INVALID", `${GOAL_FILE} needs goal (text) and owner_words, success, out_of_scope (lists of text)`)
  return g
}

const squash = (s) => s.replace(/\s+/g, " ").trim()

export function goalStatus(root, g, env = process.env) {
  const id = goalId(g)
  let status = "draft"
  if (g.confirmation?.id) {
    if (g.confirmation.id !== id) status = "changed since the owner confirmed it"
    else {
      const seen = readLines(confirmationsFile(root, env)).some((c) => c.id === id && c.at > String(g.drafted_at ?? ""))
      status = seen ? "confirmed" : "confirmed elsewhere (not verified here)"
    }
  }
  const prompts = readPrompts(root, env)
  const truncated = prompts.some((p) => p.truncated)
  const owner_words = g.owner_words.map((q) => ({
    text: q,
    observed: prompts.some((p) => squash(String(p.text)).includes(squash(q))) ? "found" : truncated ? "not verifiable" : "not found",
  }))
  return { id, status, goal: g.goal, success: g.success ?? [], out_of_scope: g.out_of_scope ?? [], owner_words,
    drafted_by: g.drafted_by ?? null, drafted_at: g.drafted_at ?? null, confirmation: g.confirmation ?? null }
}

const LABEL = { draft: "draft — not confirmed by the owner" }
export const confirmMessage = (id) => `подтверждаю цель ${id}`

export function renderGoal(s) {
  const lines = [`Owner goal [${LABEL[s.status] ?? s.status}]: ${s.goal}`]
  if (s.success.length) lines.push(`  success: ${s.success.join("; ")}`)
  if (s.out_of_scope.length) lines.push(`  out of scope: ${s.out_of_scope.join("; ")}`)
  if (s.status !== "confirmed" && s.status !== "confirmed elsewhere (not verified here)")
    lines.push(`  the owner confirms this exact draft by sending: ${confirmMessage(s.id)}`)
  return lines.join("\n")
}

export function proposeGoal(root, { goal, ownerWords, success, outOfScope, by }) {
  if (!goal?.trim()) throw new GoalError("USAGE", "goal propose needs --goal")
  if (!ownerWords.length || ownerWords.some((w) => !w.trim())) throw new GoalError("USAGE", "goal propose needs the owner's own words: --owner-words <verbatim quote> (repeatable)")
  const g = { version: 1, owner_words: ownerWords, goal: goal.trim(), success, out_of_scope: outOfScope,
    drafted_by: by, drafted_at: new Date().toISOString(), confirmation: null }
  const file = path.join(root, GOAL_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const header = "# docs/goal.yaml — the owner's goal, managed by `gatectl goal`. Its id is the digest of owner_words,\n" +
    "# goal, success and out_of_scope: editing any of them needs a new confirmation from the owner.\n"
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, header + yaml.dump(g, { lineWidth: 110 }))
  fs.renameSync(tmp, file)
  return g
}

export function confirmGoal(root, env = process.env) {
  const g = readGoal(root)
  if (!g) throw new GoalError("NO_GOAL", `${GOAL_FILE} does not exist; draft one with \`gatectl goal propose\``)
  const id = goalId(g)
  const seen = readLines(confirmationsFile(root, env)).filter((c) => c.id === id && c.at > String(g.drafted_at ?? ""))
  if (!seen.length)
    throw new GoalError("OWNER_CONFIRMATION_NOT_OBSERVED", `the gatectl hook has not seen the owner send "${confirmMessage(id)}" since this draft was written`, 1)
  g.confirmation = { id, at: seen[0].at }
  const file = path.join(root, GOAL_FILE)
  const text = fs.readFileSync(file, "utf8")
  const header = text.match(/^(#.*\n)*/)[0]
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, header + yaml.dump(g, { lineWidth: 110 }))
  fs.renameSync(tmp, file)
  return g.confirmation
}
