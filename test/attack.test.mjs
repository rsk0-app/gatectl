// The adversarial suite. Every case here is a way a hostile — or merely lazy — agent could try
// to obtain a green it did not earn. They are written as attacks rather than as features because
// that is the claim being tested: not "the gate works" but "this specific cheat is refused".
//
// A test that fails here is not a cosmetic regression. It means the engine can be talked into a
// verdict, which is the only failure mode that matters.
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync, execSync } from "node:child_process"

const BIN = path.resolve("bin/gatectl.mjs")
const stateFor = (root) => `${root}-state`
function rda(root, args, extraEnv = {}) {
  const env = { ...process.env, GATECTL_STATE_DIR: stateFor(root), ...extraEnv }
  try {
    return { code: 0, out: execFileSync("node", [BIN, ...args, "--legacy-names", "--target", root], { encoding: "utf8", env }) }
  } catch (e) { return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` } }
}
const git = (root, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root })

const POLICY = [
  "version: 1",
  "unmatched_tier: A",
  "tiers:",
  "  A:",
  "    paths: ['src/lib/auth/**']",
  "    requires: [L, R, Gfull]",
  "  B:",
  "    paths: ['src/**', 'test/**']",
  "    requires: [L, R, Gfull]",
  "commands:",
  "  typecheck: none", "  build: 'true'",
  "  test_all: 'true'",
  "  test_file: 'node red-if-missing.mjs {file}'",
  "  test_case: 'node red-if-missing.mjs {file} {selector}'",
  "failure_classes:",
  "  assertion: ['^\\s*AssertionError']",
  "  load: ['Cannot find module']",
  "  empty: ['No test matched']",
  "critic:",
  "  required_for_tiers: []",
  "meta_class: ['.gatectl/**', '.github/workflows/rda-verify.yml']",
  "",
].join("\n")

const SPEC = (extra = "") => `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts${extra}

## Allowed Paths
- src/**
- test/**

## Rollback
flag
`

// A stand-in runner: RED until the implementation lands, GREEN after — and, when handed a
// selector nobody wrote, it reports that nothing matched instead of inventing a verdict.
const RUNNER = [
  'import fs from "node:fs"',
  'const selector = process.argv[3]',
  'if (selector && selector !== "the real case") { console.log("No test matched"); process.exit(0) }',
  'if (fs.existsSync("src/impl.ts")) process.exit(0)',
  'console.log("AssertionError: expected")',
  "process.exit(1)",
  "",
].join("\n")

function scaffold({ spec = SPEC(), policy = POLICY } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rda-attack-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: root })
  rda(root, ["init"])
  fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), policy)
  fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
  fs.writeFileSync(path.join(root, "red-if-missing.mjs"), RUNNER)
  rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
  fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), spec)
  fs.mkdirSync(path.join(root, "test"), { recursive: true })
  fs.writeFileSync(path.join(root, "test/f1.test.ts"), "// asserts\n")
  git(root, "add -A"); git(root, "commit -q -m scaffold")
  return root
}
const implement = (root) => {
  fs.mkdirSync(path.join(root, "src"), { recursive: true })
  fs.writeFileSync(path.join(root, "src/impl.ts"), "export const impl = 1\n")
}
const fullCycle = (root) => {
  rda(root, ["lock"]); rda(root, ["red"]); implement(root); git(root, "add -A"); rda(root, ["gate", "full"])
}

describe("attack: weaken the tests", () => {
  it("deleting the required test is refused by name", () => {
    const root = scaffold()
    fullCycle(root)
    fs.rmSync(path.join(root, "test/f1.test.ts"))
    git(root, "add -A")
    const r = rda(root, ["gate", "full"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("test file deleted")
  })

  it("adding .only to a test is refused", () => {
    const root = scaffold()
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), 'it.only("x", () => {})\n')
    git(root, "add -A")
    const r = rda(root, ["gate", "full"])
    expect(r.code).toBe(1)
    expect(r.out).toContain(".only")
  })

  it("adding .skip to a test is refused", () => {
    const root = scaffold()
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), 'it.skip("x", () => {})\n')
    git(root, "add -A")
    expect(rda(root, ["gate", "full"]).out).toContain(".skip")
  })

  it("editing the required test after RED stales gate R rather than carrying it forward", () => {
    const root = scaffold()
    rda(root, ["lock"]); rda(root, ["red"])
    implement(root)
    fs.appendFileSync(path.join(root, "test/f1.test.ts"), "// weakened\n")
    git(root, "add -A"); rda(root, ["gate", "full"])
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("stale required tests")
  })
})

describe("attack: lie about what ran", () => {
  it("a criterion naming a case nobody wrote is NOT_EVALUATED, never RED", () => {
    const root = scaffold({ spec: SPEC('::"a case nobody wrote"') })
    rda(root, ["lock"])
    const r = rda(root, ["red"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("executed no matching test")
  })

  it("a runner that exits 0 without running anything cannot pass gate R", () => {
    const root = scaffold({ spec: SPEC('::"a case nobody wrote"') })
    rda(root, ["lock"])
    expect(rda(root, ["red"]).code).toBe(2)
  })

  it("a hostile command cannot read the signing key out of rda's environment", () => {
    const root = scaffold({
      policy: POLICY.replace("  test_all: 'true'", "  test_all: 'node steal.mjs'"),
    })
    fs.writeFileSync(path.join(root, "steal.mjs"),
      "console.log('KEY=' + (process.env.GATECTL_SIGNING_KEY ?? 'ABSENT')); process.exit(1)")
    git(root, "add -A"); git(root, "commit -q -m steal")
    fs.writeFileSync(path.join(root, "src-file.txt"), "x")
    git(root, "add -A")
    const r = rda(root, ["gate", "full"], { GATECTL_SIGNING_KEY: "SUPER-SECRET-PRIVATE-KEY" })
    expect(r.out).toContain("KEY=ABSENT")
    expect(r.out).not.toContain("SUPER-SECRET")
  })

  it("a malicious filename cannot inject a second command", () => {
    const root = scaffold()
    const evil = "a;touch PWNED;.test.ts"
    fs.writeFileSync(path.join(root, "test", evil), "// x\n")
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), SPEC().replace("test/f1.test.ts", `test/${evil}`))
    rda(root, ["lock"]); rda(root, ["red"])
    expect(fs.existsSync(path.join(root, "PWNED"))).toBe(false)
  })
})

describe("attack: move the thing that was judged", () => {
  it("editing the implementation after G-full stales the gate", () => {
    const root = scaffold()
    fullCycle(root)
    expect(rda(root, ["commit-check"]).code).toBe(0)
    fs.appendFileSync(path.join(root, "src/impl.ts"), "export const sneak = 2\n")
    git(root, "add -A")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("stale tree")
  })

  it("leaving an unstaged edit behind is caught as drift, not ignored", () => {
    const root = scaffold()
    fullCycle(root)
    fs.appendFileSync(path.join(root, "src/impl.ts"), "export const sneak = 2\n") // never staged
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("drifted from the index")
  })
})

describe("attack: disarm the referee", () => {
  it("editing the policy is a named meta-class failure", () => {
    const root = scaffold()
    fullCycle(root)
    fs.appendFileSync(path.join(root, ".gatectl/policy.yaml"), "\n# tampered\n")
    git(root, "add -A")
    const r = rda(root, ["gate", "full"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("meta-class file touched: .gatectl/policy.yaml")
  })

  it("editing the CI workflow is a named meta-class failure", () => {
    const root = scaffold()
    fullCycle(root)
    fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true })
    fs.writeFileSync(path.join(root, ".github/workflows/rda-verify.yml"), "name: nothing\n")
    git(root, "add -A")
    const r = rda(root, ["gate", "full"])
    expect(r.out).toContain("meta-class file touched: .github/workflows/rda-verify.yml")
  })

  it("forging the ledger makes gate C refuse to conclude anything at all", () => {
    const root = scaffold()
    fullCycle(root)
    const ledger = path.join(stateFor(root), fs.readdirSync(stateFor(root)).find((d) => d !== "keys"), "features/f1/gates.jsonl")
    const lines = fs.readFileSync(ledger, "utf8").trim().split("\n")
    const first = JSON.parse(lines[0])
    first.entry.tree = "9".repeat(40) // claim the gate was green over a tree it never saw
    fs.writeFileSync(ledger, [JSON.stringify(first), ...lines.slice(1)].join("\n") + "\n")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("not trustworthy")
  })

  it("inventing a ledger entry for a gate that never ran is refused", () => {
    const root = scaffold()
    rda(root, ["lock"])
    const dir = path.join(stateFor(root), fs.readdirSync(stateFor(root)).find((d) => d !== "keys"), "features/f1")
    const ledger = path.join(dir, "gates.jsonl")
    const last = JSON.parse(fs.readFileSync(ledger, "utf8").trim().split("\n").pop())
    fs.appendFileSync(ledger, JSON.stringify({
      entry: { gate: "Gfull", status: "PASS", digest: last.entry.digest, tree: last.entry.tree, at: "t" },
      prev: last.mac, mac: "f".repeat(64),
    }) + "\n")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("does not match its signature")
  })
})

describe("attack: get a cheaper tier", () => {
  it("a path no tier claims falls to the highest ceremony, not the lowest", () => {
    const root = scaffold()
    fs.writeFileSync(path.join(root, "Makefile"), "all:\n\techo hi\n")
    git(root, "add -A")
    const r = rda(root, ["status"])
    expect(r.out).toContain("tier: A")
  })

  it("a wide glob cannot buy tier B ceremony for tier A code", () => {
    const root = scaffold()
    rda(root, ["lock"]) // locked at B: allowed_paths say src/**, test/**
    fs.mkdirSync(path.join(root, "src/lib/auth"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/lib/auth/session.ts"), "export const s = 1\n")
    git(root, "add -A")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("tier escalated B → A")
  })
})
