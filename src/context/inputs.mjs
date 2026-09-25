// src/context/inputs.mjs — what an attempt or a conclusion was based on, and whether that still holds.
//
// A fingerprint is only worth keeping if an equal fingerprint means an unchanged input. So a
// directory is refused (its marker would stay equal while every file in it changed), and an input
// that cannot be read yields `unknown` freshness however the markers compare.
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WorkError } from "./store.mjs"

function insideRoot(realRoot, real) {
  return real === realRoot || real.startsWith(realRoot + path.sep)
}

const lexists = (p) => { try { fs.lstatSync(p); return true } catch { return false } }

// Where a path really points, following symlinks even when their target does not exist: a dangling
// link to a file outside the project is still outside the project.
function realLocation(p) {
  for (let hops = 0; hops < 40; hops++) {
    let probe = p
    while (!lexists(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe)
    const rest = path.relative(probe, p)
    if (fs.lstatSync(probe).isSymbolicLink()) { p = path.resolve(path.dirname(probe), fs.readlinkSync(probe), rest); continue }
    return path.join(fs.realpathSync(probe), rest)
  }
  throw new WorkError("INPUT_OUTSIDE_WORKTREE", `${p} has too many levels of symbolic links`)
}

// Paths are resolved against the worktree root, never the caller's cwd, and must stay inside it
// after symlinks are followed: a link to /etc/hosts is not part of this project.
export function resolveInput(root, input) {
  const realRoot = fs.realpathSync(root)
  const abs = path.resolve(realRoot, input)
  const rel = path.relative(realRoot, abs)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
    throw new WorkError("INPUT_OUTSIDE_WORKTREE", `${input} is not a file inside the worktree ${realRoot}`)
  const real = realLocation(abs)
  if (!insideRoot(realRoot, real))
    throw new WorkError("INPUT_OUTSIDE_WORKTREE", `${input} resolves outside the worktree (${real})`)
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory())
    throw new WorkError("INPUT_IS_DIRECTORY", `${input} is a directory; name the files the conclusion depends on`)
  return rel.split(path.sep).join("/")
}

export function fingerprint(root, rel) {
  const file = path.join(root, rel)
  try {
    return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return "absent"
    if (e.code === "EISDIR") return "unreadable"
    return "unreadable"
  }
}

export function fingerprintInputs(root, inputs) {
  const rels = [...new Set(inputs.map((i) => resolveInput(root, i)))].sort()
  return rels.map((p) => ({ path: p, fp: fingerprint(root, p) }))
}

export const inputsKey = (inputs) => JSON.stringify(inputs.map((i) => [i.path, i.fp]))

// current: every input readable now and unchanged. stale: every input readable, and something
// changed or vanished. unknown: no inputs recorded, or any input unreadable or absent then or now
// (an absent file is not a readable one), or a recorded path that no longer resolves inside the
// worktree. Unreadable wins over changed: a conclusion we cannot re-check is not known to be stale.
export function freshness(root, inputs) {
  if (!inputs.length) return "unknown"
  const now = inputs.map((i) => {
    try { return fingerprint(root, resolveInput(root, i.path)) } catch { return "unreadable" }
  })
  if (inputs.some((i, n) => i.fp === "unreadable" || now[n] === "unreadable")) return "unknown"
  if (inputs.some((i, n) => now[n] !== i.fp)) return "stale"
  if (inputs.some((i) => i.fp === "absent")) return "unknown"
  return "current"
}
