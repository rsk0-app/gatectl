// src/core/target.mjs — the engine is a guest in the target repo; all paths repo-relative.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { execSync, spawnSync } from "node:child_process"
import yaml from "js-yaml"
import { resolveConfigDir } from "./paths.mjs"

export class TargetError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export function openTarget(root) {
  // One directory. The engine briefly read a second, older name so that installations could be
  // migrated while it still understood both; all of them were, and the branch went with the name.
  let config
  try {
    config = resolveConfigDir(root)
  } catch (e) {
    throw new TargetError(e.code === "AMBIGUOUS_CONFIG" ? "AMBIGUOUS_CONFIG" : "UNREADABLE", e.message)
  }
  const policyPath = path.join(config.dir, "policy.yaml")
  if (!fs.existsSync(policyPath)) throw new TargetError("NO_POLICY", `${policyPath} not found — run 'gatectl init'`)
  const policy = yaml.load(fs.readFileSync(policyPath, "utf8"))
  const mvpPath = path.join(config.dir, "MVP.yaml")
  const mvp = fs.existsSync(mvpPath) ? yaml.load(fs.readFileSync(mvpPath, "utf8")) : null
  return { root, policy, mvp }
}

const git = (root, args) => execSync(`git ${args}`, { cwd: root, encoding: "utf8" }).trim()

// C1/#4: a gate result must bind to the exact content it inspected. What that content IS
// depends on whether anything is staged, because that is what git will build the commit from:
//
//   something staged → the INDEX is the commit. Binding to the working tree here is a TOCTOU
//     hole: commit-check verifies one set of bytes and `git commit` writes another. The digest
//     is the real tree OID the commit would carry, so it can be compared against a commit SHA
//     later by anyone, without trusting rda. Divergence between index and working tree is a
//     separate problem — the gates RAN against the working tree — and indexDrift() reports it.
//
//   nothing staged → there is no commit shape yet. The digest covers the whole working tree
//     (tracked + untracked), which is what the gates just ran their commands against.
//
// Either way the REAL index is never touched: staged mode works on a copy, unstaged mode on a
// throwaway index built from HEAD.
//
// Nothing is carved out of the hash. Until 0.7 the gate ledger had to be excluded, because it
// lived in the repository and was appended to by the very gates that hashed it — recording gate
// L changed the tree gate R would later see, and a full cycle could never reach green. Moving
// the ledger out of the target (see core/authority.mjs) removed the exception along with the
// problem: a tree digest is now exactly the tree, and in staged mode exactly the commit's.
export function treeDigest(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rda-idx-"))
  const tmp = path.join(dir, "index")
  const env = { ...process.env, GIT_INDEX_FILE: tmp }
  try {
    if (git(root, "diff --cached --name-only")) {
      // rev-parse --git-path, not .git/index: worktrees and GIT_DIR put it elsewhere.
      fs.copyFileSync(path.resolve(root, git(root, "rev-parse --git-path index")), tmp)
    } else {
      execSync("git read-tree HEAD", { cwd: root, env, stdio: "pipe" })
      execSync("git add -A", { cwd: root, env, stdio: "pipe" })
    }
    return execSync("git write-tree", { cwd: root, env, encoding: "utf8" }).trim()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// #4, the other half of the TOCTOU hole: the gates run their commands (build, full suite,
// typecheck) against the WORKING TREE, while a staged commit carries the index. If the two
// disagree, a green gate proves something about bytes that will not be committed — an unstaged
// edit, or an untracked helper file that exists while the suite runs and is absent afterwards.
//
// Reported, never repaired: staging on the agent's behalf would be gatectl editing the commit it
// is supposed to be judging.
//
// With nothing staged there is no index state to diverge from, and the working tree is exactly
// what the gates saw: no drift by construction.
export function indexDrift(root) {
  if (!git(root, "diff --cached --name-only")) return []
  const modified = git(root, "diff --name-only").split("\n").filter(Boolean)
  const untracked = git(root, "ls-files --others --exclude-standard").split("\n").filter(Boolean)
  return [...new Set([...modified, ...untracked])]
}

// C5: gates L and R are, by protocol design, recorded BEFORE the implementation exists, while
// G-fast/G-full run after it — binding all of them to the whole working tree would make gate C
// unsatisfiable for any tier requiring both. Gate R instead binds to the only thing it actually
// proved: the content of the required test files that were RED. Implementation code may then
// change freely (that is the point of the RED→implement loop), but weakening or replacing a
// required test after RED still stales the gate. A missing required test hashes to a distinct
// marker, so deleting one is a change, never a match.
export function testsDigest(root, files) {
  const h = crypto.createHash("sha256")
  for (const rel of [...files].sort()) {
    const abs = path.join(root, rel)
    h.update(rel)
    h.update("\0")
    h.update(fs.existsSync(abs) ? fs.readFileSync(abs) : Buffer.from("<missing>"))
    h.update("\0")
  }
  return h.digest("hex")
}

export function changedPaths(root) {
  const staged = git(root, "diff --cached --name-only").split("\n").filter(Boolean)
  if (staged.length > 0) return staged // a commit gates what it commits
  const tracked = git(root, "diff --name-only HEAD").split("\n").filter(Boolean)
  const untracked = git(root, "ls-files --others --exclude-standard").split("\n").filter(Boolean)
  return [...new Set([...tracked, ...untracked])]
}

// C2: the template is trusted policy config, split on whitespace once; {file}/{files}
// tokens are substituted as whole ARGV elements (never re-parsed by a shell), so a
// changed filename — however hostile — always arrives as exactly one argument.
// Secrets the child must never see. Every command gatectl runs — build, test, install — is code from
// the repository being judged, and `npm install` alone executes lifecycle scripts from it. A
// signing key in that environment is a signing key that branch can print. The two-job CI split
// keeps the key out of the runner entirely; this is the same rule enforced one level down, for
// every other way gatectl might be invoked.
//
// GITHUB_TOKEN goes too: it is write access to the repository handed to code that is being
// decided about. A project that genuinely needs a variable in its build declares it in policy
// (`commands.env_allow`), in a meta-class file agents never edit — a decision, in writing,
// rather than an accident of the ambient environment.
// What must never reach a command the repository controls. Both spellings of the engine's key
// variables are here: the engine no longer READS the older one, but a shell or a CI job may still
// hold it, and a variable nobody reads is still a live secret if it is handed to a test runner.
//
// The key list is ABSOLUTE — `allow` cannot re-admit anything on it. It could once, and that made
// the denylist advisory: a policy naming `GATECTL_SIGNING_KEY` in `commands.env_allow` would have
// handed the signing key to the very commands the signature is supposed to be independent of. A
// policy is meta-class and agents may not edit it, so this was a hole a person had to dig by hand —
// but a guarantee that a typo can switch off is not a guarantee.
// The engine's own key material. Nothing a repository runs has any business reading it, so no
// policy may ask for it back.
const NEVER_INHERITED = [
  "GATECTL_SIGNING_KEY", "GATECTL_ATTEST_KEY",
  "RDA_SIGNING_KEY", "RDA_ATTEST_KEY",
]

// Withheld by default, but a policy may ask for it: a test that talks to the GitHub API needs it,
// and unlike a signing key it is the target's own credential rather than the referee's.
const WITHHELD_UNLESS_ALLOWED = ["GITHUB_TOKEN"]

export function childEnv(env, allow = []) {
  const out = { ...env }
  for (const key of NEVER_INHERITED) delete out[key]
  for (const key of WITHHELD_UNLESS_ALLOWED) if (!allow.includes(key)) delete out[key]
  return out
}

export function commandArgv(cmdTemplate, subst = {}) {
  const argv = []
  for (const token of cmdTemplate.trim().split(/\s+/).filter(Boolean)) {
    if (token === "{file}") argv.push(subst.file ?? "")
    else if (token === "{selector}") argv.push(subst.selector ?? "")
    else if (token === "{files}") argv.push(...(subst.files ?? []))
    else argv.push(token)
  }
  return argv
}

export function runCmd(root, cmdTemplate, subst = {}, { env = process.env, allow = [] } = {}) {
  const argv = commandArgv(cmdTemplate, subst)
  const r = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "utf8", env: childEnv(env, allow) })
  // Streams are kept apart as well as combined: `output` feeds failure classification (gate R
  // matches patterns wherever the runner printed them), while reporting needs to know which
  // stream a line came from — see diagnostics() in core/gates.mjs.
  const stdout = r.stdout ?? ""
  const stderr = r.stderr ?? ""
  return { code: r.status ?? 2, output: `${stdout}${stderr}`, stdout, stderr }
}
