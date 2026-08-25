import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

// The compatibility layer existed to protect installations the engine could not reach. There were
// three, all ours, and all three have been migrated — so what remains is cost: two names to hold in
// mind, branches nobody exercises, and a deprecation notice for a tool no outside reader ever used.
//
// Two spellings survive on purpose, and each is tested for here rather than merely permitted: the
// reads that pull a policy out of a COMMIT, because a commit cannot be migrated the way a directory
// can, and the denylist that keeps an old secret out of the environment repository code runs in.

const ROOT = new URL("..", import.meta.url).pathname
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

describe("the key every ledger is addressed by", () => {
  it("pins the key that every ledger is addressed by", async () => {
    const { keyFrom, repoKey } = await import("../src/core/authority.mjs")
    // LITERAL vectors, not a recomputation: a test that derives its expectation the way the code
    // does passes through any coordinated edit, and a changed key does not give a wrong answer — it
    // makes a repository's whole history read as absent.
    expect(keyFrom("/srv/example/.git")).toBe("example-93b2e60d4632")
    expect(keyFrom("/x/../y/repo/.git")).toBe("repo-d40ba93a9539")
    expect(keyFrom("/w/we ird!/.git")).toBe("we-ird--11c730e8e6a2")
    expect(keyFrom("/w/we ird!/.git")).not.toContain("/")

    const root = tmp("gatectl-key-")
    execSync("git init -q -b main", { cwd: root })
    expect(repoKey(root)).toBe(keyFrom(fs.realpathSync(path.join(root, ".git"))))
  })

  it("is publishable without lying about what it is", () => {
    const pkg = JSON.parse(read("package.json"))
    expect(pkg.name).toBe("gatectl")
    expect(pkg.private).toBeUndefined()
    expect(pkg.license).toBe("Apache-2.0")
    expect(pkg.description).toBeTruthy()
    expect(Array.isArray(pkg.keywords) && pkg.keywords.length > 0).toBe(true)
    expect(pkg.repository).toBeTruthy()
    const licence = read("LICENSE")
    expect(licence).toContain("Apache License")
    expect(licence).toContain("Version 2.0")
  })
})

describe("the old name is gone from what the engine reads and says", () => {
  it("ships one command under one name", () => {
    const pkg = JSON.parse(read("package.json"))
    expect(Object.keys(pkg.bin)).toEqual(["gatectl"])
    expect(fs.existsSync(path.join(ROOT, "bin/rda.mjs"))).toBe(false)

    // A generated workflow must invoke the binary that exists, from a directory named after it.
    const ci = read("templates/ci/gatectl-verify.yml")
    expect(ci).not.toContain("bin/rda.mjs")
    expect(ci).not.toContain(".rda-engine")
    expect(ci).toContain("bin/gatectl.mjs")
  })

  it("does not look in a directory it no longer knows", async () => {
    const { resolveConfigDir } = await import("../src/core/paths.mjs")
    const root = tmp("gatectl-legacy-")
    fs.mkdirSync(path.join(root, ".rda"), { recursive: true })
    fs.writeFileSync(path.join(root, ".rda/policy.yaml"), "commands: {}\n")

    const got = resolveConfigDir(root)
    expect(got.dir).toBe(path.join(root, ".gatectl"))
    expect(got.fallback).toBeFalsy()

    const { openTarget } = await import("../src/core/target.mjs")
    let thrown
    try { openTarget(root) } catch (e) { thrown = e }
    expect(thrown?.code).toBe("NO_POLICY")
    // A message about a name the code no longer knows is a message nobody can act on.
    expect(thrown.message).toContain(".gatectl")
    expect(thrown.message).not.toContain(".rda")
  })

  it("reads one state root and only one", async () => {
    const { resolveStateDir } = await import("../src/core/paths.mjs")
    const { repoKey } = await import("../src/core/authority.mjs")
    const home = tmp("gatectl-home-")
    const root = tmp("gatectl-repo-")
    execSync("git init -q -b main", { cwd: root })
    // A machine that still carries the old root must not pull the engine back into it.
    fs.mkdirSync(path.join(home, ".rda", "state", repoKey(root)), { recursive: true })

    expect(resolveStateDir(root, { HOME: home }).dir).toBe(
      path.join(home, ".gatectl", "state", repoKey(root)),
    )
  })

  it("forgets the old environment names entirely", async () => {
    const { pickEnv } = await import("../src/core/paths.mjs")
    for (const name of ["STATE_DIR", "ATTEST_KEY", "ATTEST_PUBKEY", "SIGNING_KEY", "BASE_SHA", "HEAD_SHA"]) {
      expect(pickEnv({ [`RDA_${name}`]: "legacy" }, name)).toBeUndefined()
      expect(pickEnv({ [`GATECTL_${name}`]: "current" }, name)).toBe("current")
    }
  })

  it("leaves no trace of the name in what it says or reads", () => {
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name),
      )
    const offenders = []
    for (const file of [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "bin"))]) {
      if (!file.endsWith(".mjs")) continue
      const text = fs.readFileSync(file, "utf8")
      text.split("\n").forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return
        // The two exceptions, each carrying the comment that says why: reads of git history — the
        // committed-policy path list and the calls that use it — and the denylist.
        if (/showAt\(|gitFile\(|policyDigestAt|committedPolicyPaths|committedPubkeyPaths|carries both|NEVER_INHERITED|"RDA_SIGNING_KEY", "RDA_ATTEST_KEY",/.test(line)) return
        if (/\.rda\b|RDA_[A-Z]|\brda [a-z]|["'`]rda\//.test(line)) offenders.push(`${path.basename(file)}:${i + 1} ${t.slice(0, 90)}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it("keeps protecting a check that can still gate a merge", () => {
    const policy = read("templates/policy.yaml")
    const meta = policy.slice(policy.indexOf("meta_class:"))
    expect(meta).toContain(".gatectl/**")
    expect(meta).not.toContain(".rda/**")
    // A workflow GitHub may still hold as a required check is authority whatever it is called.
    expect(meta).toContain("gatectl-verify.yml")
    expect(meta).toContain("rda-verify.yml")
  })

  it("publishes under the name it has now", async () => {
    const { pageRef, INDEX_REF } = await import("../src/core/memory-page.mjs")
    expect(pageRef("some-slice")).toBe("gatectl/some-slice.md")
    expect(INDEX_REF).toBe("gatectl/_index.md")
  })

  it("still reads a policy out of a commit that predates the rename", () => {
    // History cannot be migrated: a commit carries `.rda/policy.yaml` for ever, and an attestation
    // issued against it must go on verifying.
    const root = tmp("gatectl-history-")
    execSync("git init -q -b main", { cwd: root })
    fs.mkdirSync(path.join(root, ".rda"), { recursive: true })
    fs.writeFileSync(path.join(root, ".rda/policy.yaml"), "version: 1\n")
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m old", { cwd: root })
    const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()

    const shown = execSync(`git show ${sha}:.rda/policy.yaml`, { cwd: root, encoding: "utf8" })
    expect(shown).toContain("version: 1")
    // And the engine's own committed-policy reader must find it — deliberately, with the reason
    // written where the exception lives, since every other read of the old spelling is gone.
    const src = read("src/cli/commands.mjs")
    expect(src).toContain('".rda/policy.yaml"')
    expect(src, "the surviving exception must say why it survives").toContain("cannot be migrated")
  })

  it("still refuses to hand an old secret to repository code", async () => {
    const { childEnv } = await import("../src/core/target.mjs")
    const out = childEnv({
      RDA_SIGNING_KEY: "leftover",
      GATECTL_SIGNING_KEY: "current",
      RDA_ATTEST_KEY: "leftover",
      GATECTL_ATTEST_KEY: "current",
      PATH: "/usr/bin",
    })
    for (const k of ["RDA_SIGNING_KEY", "GATECTL_SIGNING_KEY", "RDA_ATTEST_KEY", "GATECTL_ATTEST_KEY"]) {
      expect(out[k], `${k} must never reach a repository's own commands`).toBeUndefined()
    }
    expect(out.PATH).toBe("/usr/bin")

    // And no policy can re-admit them: an allow-list may widen what is passed, never what is denied.
    const allowed = childEnv({ GATECTL_SIGNING_KEY: "current", PATH: "/usr/bin" }, ["GATECTL_SIGNING_KEY"])
    expect(allowed.GATECTL_SIGNING_KEY).toBeUndefined()

    // The denylist keeps the old spelling precisely because it is NOT a lookup: the same variable
    // that is stripped here must no longer be resolvable as configuration anywhere.
    const { pickEnv } = await import("../src/core/paths.mjs")
    expect(pickEnv({ RDA_SIGNING_KEY: "leftover" }, "SIGNING_KEY")).toBeUndefined()
  })
})
