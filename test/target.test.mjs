import { describe, it, expect, beforeEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { openTarget, changedPaths, runCmd, childEnv, treeDigest, indexDrift, TargetError } from "../src/core/target.mjs"

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rda-target-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: root })
  fs.mkdirSync(path.join(root, ".gatectl"), { recursive: true })
  fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), "version: 1\ntiers:\n  B:\n    paths: ['src/**']\n")
  fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: launchable\n    text: works\nout_of_scope: []\n")
  return root
}

describe("openTarget", () => {
  it("loads policy and mvp", () => {
    const t = openTarget(makeRepo())
    expect(t.policy.version).toBe(1)
    expect(t.mvp.mvp_done_when[0].id).toBe("launchable")
  })
  it("throws NO_POLICY on a bare repo", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rda-bare-"))
    expect(() => openTarget(root)).toThrowError(expect.objectContaining({ code: "NO_POLICY" }))
  })
})

describe("changedPaths", () => {
  let root
  beforeEach(() => { root = makeRepo() })
  it("sees working-tree changes and untracked files", () => {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/new.ts"), "x")
    expect(changedPaths(root)).toContain("src/new.ts")
  })
  it("staged-is-truth: with something staged, only staged paths count", () => {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/staged.ts"), "x")
    fs.writeFileSync(path.join(root, "src/unstaged.ts"), "x")
    execSync("git add src/staged.ts", { cwd: root })
    const paths = changedPaths(root)
    expect(paths).toContain("src/staged.ts")
    expect(paths).not.toContain("src/unstaged.ts")
  })
})

describe("runCmd", () => {
  it("returns code and output without throwing", () => {
    const root = makeRepo()
    const script = path.join(root, "fixture.mjs")
    fs.writeFileSync(script, "console.log('hi'); process.exit(3)")
    const r = runCmd(root, "node {file}", { file: "fixture.mjs" })
    expect(r.code).toBe(3)
    expect(r.output).toContain("hi")
  })
  it("substitutes {files}", () => {
    const r = runCmd(makeRepo(), "echo {files}", { files: ["a.ts", "b.ts"] })
    expect(r.output).toContain("a.ts b.ts")
  })
  it("C2: no shell — a malicious filename cannot inject a second command", () => {
    const root = makeRepo()
    const script = path.join(root, "argv-probe.mjs")
    fs.writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)))")
    const evilName = "a;touch PWNED;.ts"
    const r = runCmd(root, `node ${path.basename(script)} {files}`, { files: [evilName] })
    expect(JSON.parse(r.output.trim())).toEqual([evilName]) // arrives as ONE argument
    expect(fs.existsSync(path.join(root, "PWNED"))).toBe(false)
  })
})

describe("treeDigest (C1)", () => {
  it("is stable for an unchanged working tree", () => {
    const root = makeRepo()
    expect(treeDigest(root)).toBe(treeDigest(root))
  })
  it("changes when a tracked file is modified in the working tree (uncommitted, unstaged)", () => {
    const root = makeRepo()
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/a.ts"), "x")
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m add", { cwd: root })
    const before = treeDigest(root)
    fs.appendFileSync(path.join(root, "src/a.ts"), "\ny")
    expect(treeDigest(root)).not.toBe(before)
  })
  it("changes when an untracked file is added", () => {
    const root = makeRepo()
    const before = treeDigest(root)
    fs.writeFileSync(path.join(root, "new-file.txt"), "x")
    expect(treeDigest(root)).not.toBe(before)
  })
  it("does not mutate the real git index", () => {
    const root = makeRepo()
    fs.writeFileSync(path.join(root, "untracked.txt"), "x")
    treeDigest(root)
    const staged = execSync("git diff --cached --name-only", { cwd: root, encoding: "utf8" }).trim()
    expect(staged).toBe("") // treeDigest must not leave anything staged in the real index
  })
  it("hashes the tree with nothing carved out — the ledger no longer lives here to be excluded", () => {
    // Until 0.7 docs/specs/<slug>/gates.json had to be excluded: it was appended to by the very
    // gates that hashed it. It now lives outside the target repository entirely, so a file under
    // docs/specs/ is an ordinary file and moves the digest like any other.
    const root = makeRepo()
    fs.mkdirSync(path.join(root, "docs/specs/f1"), { recursive: true })
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), "spec")
    const before = treeDigest(root)
    fs.writeFileSync(path.join(root, "docs/specs/f1/notes.md"), "notes")
    expect(treeDigest(root)).not.toBe(before)
  })
})

// #4 (TOCTOU): a commit commits the INDEX. Binding a gate result to the working tree while the
// commit is built from the index means the verified content and the committed content can
// differ. Once anything is staged, the staged tree is the only honest thing to bind to.
describe("treeDigest — staged-is-truth", () => {
  const commit = (root, msg) =>
    execSync(`git -c user.email=t@t -c user.name=t commit -q -m ${msg}`, { cwd: root })

  function repoWithCommit() {
    const root = makeRepo()
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1\n")
    execSync("git add -A", { cwd: root })
    commit(root, "base")
    return root
  }

  it("with something staged, the digest is the tree the commit would create", () => {
    const root = repoWithCommit()
    fs.writeFileSync(path.join(root, "src/b.ts"), "export const b = 2\n")
    execSync("git add src/b.ts", { cwd: root })
    const digest = treeDigest(root)
    commit(root, "b")
    expect(digest).toBe(execSync("git rev-parse HEAD^{tree}", { cwd: root, encoding: "utf8" }).trim())
  })

  it("with something staged, an unstaged edit elsewhere does NOT change the digest", () => {
    const root = repoWithCommit()
    fs.writeFileSync(path.join(root, "src/b.ts"), "export const b = 2\n")
    execSync("git add src/b.ts", { cwd: root })
    const before = treeDigest(root)
    fs.appendFileSync(path.join(root, "src/a.ts"), "\nexport const sneak = 3\n")
    expect(treeDigest(root)).toBe(before) // the commit would not contain it
  })

  it("staging more DOES change the digest", () => {
    const root = repoWithCommit()
    fs.writeFileSync(path.join(root, "src/b.ts"), "export const b = 2\n")
    execSync("git add src/b.ts", { cwd: root })
    const before = treeDigest(root)
    fs.appendFileSync(path.join(root, "src/a.ts"), "\nexport const c = 3\n")
    execSync("git add src/a.ts", { cwd: root })
    expect(treeDigest(root)).not.toBe(before)
  })

  it("does not mutate the real index in staged mode", () => {
    const root = repoWithCommit()
    fs.writeFileSync(path.join(root, "src/b.ts"), "export const b = 2\n")
    execSync("git add src/b.ts", { cwd: root })
    treeDigest(root)
    expect(execSync("git diff --cached --name-only", { cwd: root, encoding: "utf8" }).trim()).toBe("src/b.ts")
  })

})

// The gates run their commands against the WORKING TREE. Once something is staged, the commit
// is built from the index — so a green gate is only honest if the two agree.
describe("indexDrift", () => {
  function staged() {
    const root = makeRepo()
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1\n")
    execSync("git add -A", { cwd: root })
    return root
  }

  it("is empty when the working tree matches the index", () => {
    expect(indexDrift(staged())).toEqual([])
  })

  it("names a tracked file modified after staging", () => {
    const root = staged()
    fs.appendFileSync(path.join(root, "src/a.ts"), "\nexport const b = 2\n")
    expect(indexDrift(root)).toContain("src/a.ts")
  })

  it("names an untracked file — it is present while the gates run, absent from the commit", () => {
    const root = staged()
    fs.writeFileSync(path.join(root, "src/helper.ts"), "export const h = 1\n")
    expect(indexDrift(root)).toContain("src/helper.ts")
  })

  it("is empty when nothing is staged — there is no index state to diverge from yet", () => {
    const root = makeRepo()
    fs.writeFileSync(path.join(root, "loose.txt"), "x")
    expect(indexDrift(root)).toEqual([])
  })
})

// Every command rda runs is code from the repository being judged. `npm install` alone executes
// lifecycle scripts from it, so anything secret in rda's own environment is one `echo` away from
// the build log.
describe("runCmd — the child never inherits secrets", () => {
  it("strips the signing key, the ledger key and GITHUB_TOKEN", () => {
    const env = { PATH: "/usr/bin", GATECTL_SIGNING_KEY: "priv", GATECTL_ATTEST_KEY: "hmac", GITHUB_TOKEN: "ghs_x", HOME: "/home/x" }
    expect(childEnv(env)).toEqual({ PATH: "/usr/bin", HOME: "/home/x" })
  })

  it("passes through what the policy explicitly allows, and nothing else", () => {
    const env = { GITHUB_TOKEN: "ghs_x", GATECTL_SIGNING_KEY: "priv" }
    expect(childEnv(env, ["GITHUB_TOKEN"])).toEqual({ GITHUB_TOKEN: "ghs_x" })
  })

  it("a hostile test command cannot read the key out of the environment", () => {
    const root = makeRepo()
    fs.writeFileSync(path.join(root, "steal.mjs"), "console.log(process.env.GATECTL_SIGNING_KEY ?? 'ABSENT')")
    const r = runCmd(root, "node steal.mjs", {}, { env: { ...process.env, GATECTL_SIGNING_KEY: "SUPER-SECRET" } })
    expect(r.output).toContain("ABSENT")
    expect(r.output).not.toContain("SUPER-SECRET")
  })
})
