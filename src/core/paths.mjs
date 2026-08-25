// src/core/paths.mjs — where the engine looks for its configuration and its ledger.
//
// One name for each, deliberately. The tool had another name once, and for a while this file read
// both: a target's config directory, the state root holding every gate result ever recorded, and
// each environment variable had a second spelling. Every installation was migrated before those
// second readings were removed, in that order, because a rename that runs ahead of its migrations
// orphans the ledger — the one thing this engine exists to keep. Two places still spell the old
// name, and neither is a lookup: the reads that pull a policy or a public key out of a COMMIT, which
// cannot be migrated the way a directory can, and `NEVER_INHERITED`, which is a denylist.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { repoKey } from "./authority.mjs"

export const NEW = ".gatectl"

const HOME = (env = process.env) => env.HOME || env.USERPROFILE || os.homedir()

/**
 * The value of one setting.
 *
 * An empty string counts as unset: an empty path resolved as a path is a directory nobody meant.
 * (The engine briefly honoured an older `RDA_*` spelling for each of these. It no longer does —
 * every installation was migrated first. Those names still appear in `NEVER_INHERITED`, which is a
 * denylist rather than a lookup: a variable the engine does not read can still be a live secret in
 * someone's shell, and handing it to a repository's own test command would be a leak.)
 */
export function pickEnv(env, name) {
  const value = env[`GATECTL_${name}`]
  return typeof value === "string" && value !== "" ? value : undefined
}

/** ENOENT is absence; anything else is a question we cannot answer, and 2 is what that means. */
function presence(at) {
  try {
    return fs.statSync(at).isDirectory()
  } catch (e) {
    if (e.code === "ENOENT") return false
    const err = new Error(`cannot read ${at}: ${e.message}`)
    err.code = "UNREADABLE"
    throw err
  }
}

/**
 * Which directory holds this target's policy.
 *
 * One name, since every installation was migrated before the second one was removed. A target that
 * has not been migrated gets the ordinary NO_POLICY refusal from the caller: a message naming a
 * directory the code no longer knows is a message nobody can act on.
 */
export function resolveConfigDir(root) {
  return { dir: path.join(root, NEW), name: NEW, fallback: false }
}

/**
 * The state ROOT, without reference to any repository — the keys directory lives directly under it.
 */
export function resolveStateRoot(env = process.env) {
  const override = pickEnv(env, "STATE_DIR")
  return override ? path.resolve(override) : path.join(HOME(env), NEW, "state")
}

/**
 * Where this repository's ledger lives.
 *
 * One root. The engine once consulted an older one, so that a repository whose history predated the
 * rename kept reading AND writing where that history already was; every such repository has since
 * been moved, root and all, so the branch is gone rather than dormant.
 */
export function resolveStateDir(root, env = process.env) {
  const key = repoKey(root)
  const stateRoot = resolveStateRoot(env)
  return { dir: path.join(stateRoot, key), root: stateRoot, fallback: false }
}

const said = new Set()
/** Once per kind per invocation, on stderr, never part of a verdict — exit codes are the API. */
export function noticeOnce(kind, message) {
  if (said.has(kind)) return
  said.add(kind)
  console.error(message)
}
