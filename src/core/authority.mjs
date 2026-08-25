// src/core/authority.mjs — where gate evidence lives, and what signs it.
//
// Everything here exists to move the evidence out of reach of the thing being judged. The
// ledger and the attestation live under a state directory outside the target repository, and
// the key that signs them lives outside both. A worker agent editing the repository can no
// longer edit its own record of having passed.
//
// The limit, stated plainly: on one machine, under one user, the key file is readable by
// whatever the agent can run. This is a real boundary against tampering in the repository, an
// accidental rewrite, a forged ledger arriving in a pull request, and replay of an old green
// onto a new tree. It is NOT a boundary against an agent that goes looking for the key. That
// needs the runner to be a separate principal — a CI job or a daemon holding the key — which is
// exactly what `gatectl verify` is shaped for: give CI the key via GATECTL_ATTEST_KEY and let it check
// an attestation it did not produce.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { resolveStateDir, resolveStateRoot, pickEnv } from "./paths.mjs"
import { execSync } from "node:child_process"

const HOME = () => os.homedir()

// Identity of the repository, not of the checkout: worktrees of the same repository share a
// common git dir and therefore share one ledger. Realpath first, so /tmp and /private/tmp on
// macOS do not produce two different identities for one repository.
/**
 * The pure half of the key: a git-common-dir path in, a directory name out.
 *
 * Split out so a golden vector can pin it. Every ledger ever written is addressed by this function,
 * so an edit to it does not produce a wrong answer — it produces a repository whose entire history
 * reads as absent.
 */
export function keyFrom(realGitDir) {
  const hash = crypto.createHash("sha256").update(realGitDir).digest("hex").slice(0, 12)
  const name = path.basename(path.dirname(realGitDir)).replace(/[^A-Za-z0-9._-]/g, "-") || "repo"
  return `${name}-${hash}`
}

export function repoKey(root) {
  let gitDir
  try {
    gitDir = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: root, encoding: "utf8" }).trim()
  } catch {
    gitDir = path.join(root, ".git") // not a repository yet: still deterministic per path
  }
  const real = fs.existsSync(gitDir) ? fs.realpathSync(gitDir) : gitDir
  return keyFrom(real)
}

// The ledger's address, delegated to paths.mjs so that one rule — a repository keeps using the root
// its history is already in — governs reads and writes alike. See resolveStateDir for why "read old,
// write new" would have hidden every pre-rename result behind the first post-rename write.
export const stateRoot = (env = process.env) => resolveStateRoot(env)

export const stateDir = (root, env = process.env) => resolveStateDir(root, env).dir

export const ledgerFile = (root, slug, env = process.env) =>
  path.join(stateDir(root, env), "features", slug, "gates.jsonl")

export const attestationFile = (root, slug, env = process.env) =>
  path.join(stateDir(root, env), "features", slug, "attestation.json")

// Gate X's review lives out here for a reason of its own, on top of the authority one: a review
// of a tree must not change the tree it reviewed. Written into docs/specs/, it would move the
// working state the moment it was saved, staling the G-full that had just gone green over the
// exact diff under review. Findings are resolved by editing this file — same RESOLVED: line as
// a critique, one directory further out.
export const reviewFile = (root, slug, env = process.env) =>
  path.join(stateDir(root, env), "features", slug, "review.md")

// A key per repository, 32 random bytes, mode 0600. GATECTL_ATTEST_KEY wins when set — that is how
// a CI job verifies an attestation produced on a developer's machine, and how a team shares one
// verifier without sharing a filesystem.
//
// `create: false` refuses to invent a key: `gatectl verify` must never "succeed" by generating a
// fresh key and finding the attestation unverifiable against it. It says the key is missing.
export function loadKey(root, { env = process.env, create = true } = {}) {
  if (pickEnv(env, "ATTEST_KEY")) {
    const raw = pickEnv(env, "ATTEST_KEY").trim()
    if (raw.length < 16) return { ok: false, detail: "GATECTL_ATTEST_KEY is set but shorter than 16 characters" }
    return { ok: true, key: Buffer.from(raw, "utf8"), source: "GATECTL_ATTEST_KEY" }
  }
  const file = path.join(stateRoot(env), "keys", `${repoKey(root)}.key`)
  if (!fs.existsSync(file)) {
    if (!create) return { ok: false, detail: `no signing key at ${file} and none in GATECTL_ATTEST_KEY` }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex") + "\n", { mode: 0o600 })
  }
  return { ok: true, key: Buffer.from(fs.readFileSync(file, "utf8").trim(), "utf8"), source: file }
}

// ── issuer keys ───────────────────────────────────────────────────────────────────────────────
//
// The issuer is whoever re-runs the gates on a clean checkout and is prepared to be believed for
// it — in practice a CI job. Its PRIVATE key never leaves that principal: on a developer machine
// there is normally no reason for one to exist at all. Its PUBLIC key is meant to travel.
//
// Where a verifier gets that public key decides what the verification is worth, so the order is
// deliberate and the weakest source announces itself:
//
//   --pubkey <file>        explicit, strongest — the verifier chose it
//   GATECTL_ATTEST_PUBKEY  a secret or pinned value in the verifying environment
//   the config directory's attest.pub        convenience, and only as trustworthy as the repository: anyone who
//                          can commit can swap this key for their own and sign with the match
//
// The last one is not a mistake to be fixed by hiding it — it is genuinely useful for humans
// reading a PR — but gatectl says out loud when a verdict rests on it.
export function generateIssuerKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

// Accepts a PEM as-is or base64-wrapped, because CI secret UIs mangle multi-line values often
// enough that "paste it base64" is the standard workaround.
function pem(text) {
  const raw = (text ?? "").trim()
  if (raw.includes("-----BEGIN")) return raw
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8")
    if (decoded.includes("-----BEGIN")) return decoded
  } catch { /* not base64 */ }
  return null
}

export const issuerKeyFile = (root, env = process.env) =>
  path.join(stateRoot(env), "keys", `${repoKey(root)}.issuer.pem`)

export function loadIssuerKey(root, { env = process.env, create = false } = {}) {
  if (pickEnv(env, "SIGNING_KEY")) {
    const text = pem(pickEnv(env, "SIGNING_KEY"))
    if (!text) return { ok: false, detail: "GATECTL_SIGNING_KEY is set but is not a PEM private key (raw or base64)" }
    try { return { ok: true, key: crypto.createPrivateKey(text), source: "GATECTL_SIGNING_KEY" } }
    catch (e) { return { ok: false, detail: `GATECTL_SIGNING_KEY could not be read: ${e.message}` } }
  }
  const file = issuerKeyFile(root, env)
  if (!fs.existsSync(file)) {
    if (!create) return { ok: false, detail: `no issuer key: set GATECTL_SIGNING_KEY, or run 'gatectl keygen'` }
    const { privatePem } = generateIssuerKeypair()
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, privatePem, { mode: 0o600 })
  }
  return { ok: true, key: crypto.createPrivateKey(fs.readFileSync(file, "utf8")), source: file }
}

export function loadVerifyKey({ explicitPath, env = process.env, repoPubkey } = {}) {
  const from = (text, source, trusted) => {
    const t = pem(text)
    if (!t) return { ok: false, detail: `${source} is not a PEM public key` }
    try { return { ok: true, key: crypto.createPublicKey(t), source, trusted } }
    catch (e) { return { ok: false, detail: `${source} could not be read: ${e.message}` } }
  }
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) return { ok: false, detail: `no such public key file: ${explicitPath}` }
    return from(fs.readFileSync(explicitPath, "utf8"), explicitPath, true)
  }
  if (pickEnv(env, "ATTEST_PUBKEY")) return from(pickEnv(env, "ATTEST_PUBKEY"), "GATECTL_ATTEST_PUBKEY", true)
  if (repoPubkey) return from(repoPubkey, "the config directory's attest.pub (from the commit)", false)
  return { ok: false, detail: "no public key: pass --pubkey <file>, set GATECTL_ATTEST_PUBKEY, or commit the config directory's attest.pub" }
}
