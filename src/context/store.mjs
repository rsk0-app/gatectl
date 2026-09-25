// src/context/store.mjs — the per-worktree work store: questions, attempts, conclusions, checkpoints.
//
// Context, never evidence. No gate reads this file's data (test/work-state.test.mjs holds that line),
// so what matters here is the other promise: the record of how the work went is not lost. An
// existing store is validated before anything writes to it, on a disposable copy, so a store this
// code cannot read — damaged, truncated, or written by a newer gatectl — is refused and left exactly
// as it was. The alternative, opening it and letting SQLite "recover", or starting a fresh empty
// store beside it, is how a week of recorded attempts silently becomes nothing.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import { stateDir } from "../core/authority.mjs"

export const SCHEMA_VERSION = 1

export class WorkError extends Error {
  constructor(code, message, exit = 2) {
    super(`${code}: ${message}`)
    this.code = code
    this.exit = exit
  }
}

// node:sqlite is loaded here and nowhere else, lazily: every other command must keep working on a
// runtime that does not have it. `GATECTL_WORK_SQLITE=off` is the owner's switch to disable the
// store entirely, and the honest way to exercise that path.
export async function loadSqlite(env = process.env) {
  if (env.GATECTL_WORK_SQLITE === "off") return null
  const emit = process.emitWarning
  // The module announces itself as experimental on some Node lines; that notice is not ours to
  // print on every command.
  process.emitWarning = (warning, ...rest) =>
    /sqlite/i.test(String(warning?.message ?? warning)) ? undefined : emit.call(process, warning, ...rest)
  try {
    return await import("node:sqlite")
  } catch (e) {
    if (e?.code === "ERR_UNKNOWN_BUILTIN_MODULE") return null
    throw e
  } finally {
    process.emitWarning = emit
  }
}

export function worktreeRoot(root) {
  try {
    return fs.realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim())
  } catch {
    return fs.realpathSync(root)
  }
}

// One store per worktree: worktrees of one repository share a state directory (it is keyed by the
// common git dir), so the worktree's own root is what separates them.
export function storePath(root) {
  const top = worktreeRoot(root)
  const key = crypto.createHash("sha256").update(top).digest("hex").slice(0, 16)
  return path.join(stateDir(top), "worktrees", key, "work.db")
}

const MIGRATIONS = [
  // 1: initial schema
  `CREATE TABLE questions (
     id INTEGER PRIMARY KEY, work TEXT NOT NULL, text TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('technical','decision')),
     status TEXT NOT NULL CHECK (status IN ('open','answered','blocked')),
     by TEXT, created_at TEXT NOT NULL, closed_at TEXT);
   CREATE TABLE attempts (
     id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id), work TEXT NOT NULL,
     hypothesis TEXT NOT NULL, action TEXT NOT NULL, inputs TEXT NOT NULL, inputs_key TEXT NOT NULL,
     reason TEXT, by TEXT,
     status TEXT NOT NULL CHECK (status IN ('planned','done')),
     outcome TEXT CHECK (outcome IN ('progress','no_progress','answered','blocked')),
     result TEXT, remaining TEXT, revisit TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
   CREATE TABLE conclusions (
     id INTEGER PRIMARY KEY, work TEXT NOT NULL,
     question_id INTEGER REFERENCES questions(id), attempt_id INTEGER REFERENCES attempts(id),
     text TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('declaration','fact','hypothesis','check')),
     by TEXT, inputs TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE checkpoints (
     id INTEGER PRIMARY KEY, work TEXT NOT NULL, goal TEXT, done_when TEXT, next_action TEXT NOT NULL,
     summary TEXT, by TEXT, created_at TEXT NOT NULL);
   CREATE INDEX attempts_question ON attempts(question_id);`,
]
if (MIGRATIONS.length !== SCHEMA_VERSION) throw new Error("work store migrations out of step with SCHEMA_VERSION")

// Validation happens on a copy in a private temporary directory: opening the real file, even
// read-only, can replay or checkpoint its WAL and touch the shared-memory index. The copy may be
// changed freely; the original is only opened once it is known to be readable and not newer.
function validateExisting(file, sqlite) {
  let size
  try { size = fs.statSync(file).size }
  catch (e) { throw new WorkError("STORE_UNREADABLE", `${file} cannot be read (${e.code ?? e.message}); it was left untouched.`) }
  if (size === 0) throw new WorkError("STORE_UNREADABLE", `${file} is empty (truncated?). It was left untouched; restore it from a \`gatectl work export\`, or move it aside yourself to start over.`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatectl-work-check-"))
  try {
    const copy = path.join(dir, "work.db")
    let db
    try {
      fs.copyFileSync(file, copy)
      if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`)
      db = new sqlite.DatabaseSync(copy)
      const check = db.prepare("PRAGMA quick_check").get()
      if (Object.values(check ?? {})[0] !== "ok") throw new Error(`integrity check: ${JSON.stringify(check)}`)
      const version = db.prepare("PRAGMA user_version").get().user_version
      if (version > SCHEMA_VERSION)
        throw new WorkError("STORE_TOO_NEW", `${file} has schema ${version}; this gatectl understands up to ${SCHEMA_VERSION}. Upgrade gatectl; the store was left untouched.`)
      return version
    } catch (e) {
      if (e instanceof WorkError) throw e
      throw new WorkError("STORE_UNREADABLE", `${file} cannot be read (${e.message}). It was left untouched; restore it from a \`gatectl work export\`, or move it aside yourself to start over.`)
    } finally {
      try { db?.close() } catch { /* the copy is discarded anyway */ }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE")
  try {
    const result = fn()
    db.exec("COMMIT")
    return result
  } catch (e) {
    try { db.exec("ROLLBACK") } catch { /* already rolled back by SQLite */ }
    throw e
  }
}

// A companion without its database means the store was damaged, not that it never existed.
export const orphanCompanion = (file) => ["-wal", "-shm", "-journal"].map((s) => file + s).find((f) => fs.existsSync(f)) ?? null

// Returns null when there is no store and `create` is false: reading must never create one.
export function openStore(root, sqlite, { create }) {
  const file = storePath(root)
  const exists = fs.existsSync(file)
  if (!exists && orphanCompanion(file))
    throw new WorkError("STORE_UNREADABLE", `${file} is missing but ${orphanCompanion(file)} remains; the store was left untouched.`)
  if (!exists && !create) return null
  if (exists) validateExisting(file, sqlite)
  else fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  let db
  try { db = new sqlite.DatabaseSync(file) }
  catch (e) { throw new WorkError("STORE_UNREADABLE", `${file} cannot be opened (${e.message}); it was left untouched.`) }
  db.exec("PRAGMA busy_timeout = 10000")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  // A current store needs no write lock just to be read; only a migration takes one.
  if (db.prepare("PRAGMA user_version").get().user_version === SCHEMA_VERSION) return db
  transaction(db, () => {
    // Re-read inside the write lock: two first uses racing must not both migrate.
    const version = db.prepare("PRAGMA user_version").get().user_version
    if (version > SCHEMA_VERSION) throw new WorkError("STORE_TOO_NEW", `${file} changed to schema ${version} while opening`)
    for (let v = version; v < SCHEMA_VERSION; v++) db.exec(MIGRATIONS[v])
    if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  })
  if (!exists) try { fs.chmodSync(file, 0o600) } catch { /* best effort */ }
  return db
}
