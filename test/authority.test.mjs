import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { repoKey, stateDir, ledgerFile, loadKey, generateIssuerKeypair, loadIssuerKey, loadVerifyKey } from "../src/core/authority.mjs"

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rda-auth-"))
  execSync("git init -q -b main", { cwd: root })
  return root
}
const env = () => ({ GATECTL_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "rda-state-")) })

describe("repoKey", () => {
  it("is stable for the same repository and different across repositories", () => {
    const a = makeRepo(); const b = makeRepo()
    expect(repoKey(a)).toBe(repoKey(a))
    expect(repoKey(a)).not.toBe(repoKey(b))
  })
  it("is shared by worktrees of one repository — one repository, one ledger", () => {
    const root = makeRepo()
    fs.writeFileSync(path.join(root, "f.txt"), "x")
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m init", { cwd: root })
    const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rda-wt-")), "w")
    execSync(`git worktree add -q -b side ${wt}`, { cwd: root })
    expect(repoKey(wt)).toBe(repoKey(root))
  })
  it("carries a readable repository name, so the state directory can be inspected by a human", () => {
    const root = makeRepo()
    expect(repoKey(root)).toContain(path.basename(root))
  })
})

describe("state layout", () => {
  it("keeps the ledger OUT of the target repository — the whole point", () => {
    const root = makeRepo(); const e = env()
    const p = ledgerFile(root, "f1", e)
    expect(p.startsWith(root)).toBe(false)
    expect(p).toContain(repoKey(root))
    expect(p.endsWith(path.join("features", "f1", "gates.jsonl"))).toBe(true)
  })
  it("GATECTL_STATE_DIR redirects the whole tree", () => {
    const root = makeRepo(); const e = env()
    expect(stateDir(root, e).startsWith(e.GATECTL_STATE_DIR)).toBe(true)
  })
})

describe("loadKey", () => {
  it("creates a per-repository key file readable only by its owner", () => {
    const root = makeRepo(); const e = env()
    const r = loadKey(root, { env: e })
    expect(r.ok).toBe(true)
    expect(fs.statSync(r.source).mode & 0o077).toBe(0) // no group or other access
    expect(loadKey(root, { env: e }).key.equals(r.key)).toBe(true) // stable
  })
  it("GATECTL_ATTEST_KEY wins — that is how CI verifies without a shared filesystem", () => {
    const root = makeRepo()
    const r = loadKey(root, { env: { GATECTL_ATTEST_KEY: "0123456789abcdef0123" } })
    expect(r.source).toBe("GATECTL_ATTEST_KEY")
  })
  it("refuses a too-short GATECTL_ATTEST_KEY rather than signing with it", () => {
    expect(loadKey(makeRepo(), { env: { GATECTL_ATTEST_KEY: "short" } }).ok).toBe(false)
  })
  it("with create:false, a missing key is an answer, never a freshly invented one", () => {
    const r = loadKey(makeRepo(), { env: env(), create: false })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("no signing key")
  })
})

describe("issuer keys", () => {
  const kp = generateIssuerKeypair()

  it("generates a usable ed25519 pair", () => {
    expect(kp.privatePem).toContain("BEGIN PRIVATE KEY")
    expect(kp.publicPem).toContain("BEGIN PUBLIC KEY")
  })

  it("refuses to invent a signing key unless asked — an issuer key is not something to conjure", () => {
    const r = loadIssuerKey(makeRepo(), { env: env() })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("gatectl keygen")
  })

  it("creates one on request, readable only by its owner", () => {
    const root = makeRepo(); const e = env()
    const r = loadIssuerKey(root, { env: e, create: true })
    expect(r.ok).toBe(true)
    expect(fs.statSync(r.source).mode & 0o077).toBe(0)
  })

  it("the signing key from the environment wins, raw PEM or base64 — CI secret UIs mangle multi-line values", () => {
    const root = makeRepo()
    expect(loadIssuerKey(root, { env: { GATECTL_SIGNING_KEY: kp.privatePem } }).source).toBe("GATECTL_SIGNING_KEY")
    const b64 = Buffer.from(kp.privatePem, "utf8").toString("base64")
    expect(loadIssuerKey(root, { env: { GATECTL_SIGNING_KEY: b64 } }).ok).toBe(true)
  })

  it("refuses a malformed signing key instead of falling back to a file", () => {
    expect(loadIssuerKey(makeRepo(), { env: { GATECTL_SIGNING_KEY: "hunter2" } }).ok).toBe(false)
  })
})

describe("verification keys — where the key came from decides what the verdict is worth", () => {
  const kp = generateIssuerKeypair()

  it("an explicit --pubkey file is trusted", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rda-pub-")), "attest.pub")
    fs.writeFileSync(f, kp.publicPem)
    const r = loadVerifyKey({ explicitPath: f, env: {} })
    expect(r.ok).toBe(true)
    expect(r.trusted).toBe(true)
  })

  it("GATECTL_ATTEST_PUBKEY is trusted", () => {
    expect(loadVerifyKey({ env: { GATECTL_ATTEST_PUBKEY: kp.publicPem } })).toMatchObject({ ok: true, trusted: true })
  })

  it("a key out of the repository is USED but marked untrusted — anyone who can commit can swap it", () => {
    const r = loadVerifyKey({ env: {}, repoPubkey: kp.publicPem })
    expect(r.ok).toBe(true)
    expect(r.trusted).toBe(false)
  })

  it("says so plainly when there is no key at all", () => {
    expect(loadVerifyKey({ env: {} })).toMatchObject({ ok: false })
  })
})
