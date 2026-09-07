import { describe, it, expect, beforeEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync, execSync } from "node:child_process"
import yaml from "js-yaml"
import { compileSpec } from "../src/core/spec-compile.mjs"
import { specDigest } from "../src/core/lock.mjs"

const BIN = path.resolve("bin/gatectl.mjs")
// The ledger, the attestation and the signing key live OUTSIDE the target repository — that is
// the point of them. Each test repository gets its own state tree next to it, so tests neither
// share state nor write into the developer's real one.
const stateFor = (root) => `${root}-state`
const stateFeatureDir = (root, slug) =>
  path.join(stateFor(root), fs.readdirSync(stateFor(root)).find((d) => d !== "keys"), "features", slug)
const attestationOf = (root, slug) =>
  JSON.parse(fs.readFileSync(path.join(stateFeatureDir(root, slug), "attestation.json"), "utf8"))
function rda(root, args, extraEnv = {}) {
  const env = { ...process.env, GATECTL_STATE_DIR: stateFor(root), ...extraEnv }
  try {
    return { code: 0, out: execFileSync("node", [BIN, ...args, "--legacy-names", "--target", root], { encoding: "utf8", env }) }
  } catch (e) { return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` } }
}
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rda-e2e-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: root })
  return root
}

describe("gatectl init (AC1)", () => {
  it("scaffolds .rda + docs/specs and is idempotent", () => {
    const root = makeRepo()
    expect(rda(root, ["init"]).code).toBe(0)
    expect(fs.existsSync(path.join(root, ".gatectl/policy.yaml"))).toBe(true)
    expect(fs.existsSync(path.join(root, ".gatectl/MVP.yaml"))).toBe(true)
    const before = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    expect(rda(root, ["init"]).code).toBe(0) // second run: no error
    expect(fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")).toBe(before) // no overwrite
  })
})

describe("gatectl new + lock (AC2, AC3)", () => {
  let root
  beforeEach(() => {
    root = makeRepo()
    rda(root, ["init", "--mode", "strict"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"),
      "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
  })
  const writeSpec = (extra = "") => fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**
- test/**

## Rollback
flag
${extra}`)

  it("new scaffolds and sets ACTIVE", () => {
    expect(rda(root, ["new", "f1"]).code).toBe(0)
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    expect(fs.readFileSync(path.join(root, "docs/specs/ACTIVE"), "utf8").trim()).toBe("f1")
  })
  it("new works without --target when cwd is the target repo", () => {
    // GATECTL_STATE_DIR here for the same reason the rda() helper sets it: `init` creates a signing
    // key, and a test that omits it writes one into the developer's real state directory.
    const opts = { cwd: root, encoding: "utf8", env: { ...process.env, GATECTL_STATE_DIR: stateFor(root) } }
    execFileSync("node", [BIN, "init"], opts)
    execFileSync("node", [BIN, "new", "f1"], opts)
    expect(fs.readFileSync(path.join(root, "docs/specs/ACTIVE"), "utf8").trim()).toBe("f1")
  })
  it("lock refuses (exit 2) without a critique for tier B, names the reason", () => {
    rda(root, ["new", "f1"]); writeSpec()
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    const r = rda(root, ["lock"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("critique")
  })
  it("lock succeeds with a resolved critique; relock same digest is a no-op (AC2)", () => {
    rda(root, ["new", "f1"]); writeSpec()
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. HIGH — x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    expect(rda(root, ["lock"]).code).toBe(0)
    const locks = JSON.parse(fs.readFileSync(path.join(root, "docs/specs/f1/spec.lock.json"), "utf8"))
    expect(locks).toHaveLength(1)
    expect(locks[0].version).toBe(1)
    expect(rda(root, ["lock"]).code).toBe(0)
    expect(JSON.parse(fs.readFileSync(path.join(root, "docs/specs/f1/spec.lock.json"), "utf8"))).toHaveLength(1)
  })
  it("lock exits 1 on open BLOCKING question (AC3)", () => {
    rda(root, ["new", "f1"]); writeSpec("\nBLOCKING: разделитель?\n")
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. HIGH — x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    expect(rda(root, ["lock"]).code).toBe(1)
  })
})

describe("C4 — unknown tier / empty requires must never PASS", () => {
  const spec = (allowed) => `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- ${allowed}

## Rollback
flag
`
  function setup(policyYaml) {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), policyYaml)
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    return root
  }

  it("commit-check exits 2 when the resolved tier's policy has no requires", () => {
    const root = setup(
      "version: 1\nunmatched_tier: A\ntiers:\n  A:\n    paths: ['x/**']\n  B:\n    paths: ['src/**']\n  C:\n    paths: ['docs/**']\n")
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), spec("src/**"))
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(2)
    expect(r.out.toLowerCase()).toContain("requires")
  })

  it("commit-check exits 2 when requires is present but empty", () => {
    const root = setup(
      "version: 1\nunmatched_tier: A\ntiers:\n  A:\n    paths: ['x/**']\n  B:\n    paths: ['src/**']\n    requires: []\n  C:\n    paths: ['docs/**']\n")
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), spec("src/**"))
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(2)
    expect(r.out.toLowerCase()).toContain("requires")
  })

  it("status prints tier \"?\" instead of crashing when unmatched_tier names an unknown tier", () => {
    const root = setup(
      "version: 1\nunmatched_tier: Z\ntiers:\n  A:\n    paths: ['x/**']\n    requires: [L]\n")
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), spec("nomatch/**"))
    const r = rda(root, ["status"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("tier: ?")
  })
})

describe("I2 — gateR missing-command guard", () => {
  it("gatectl red exits 2 with a named reason when policy has no test_file command, instead of crashing", () => {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"),
      "version: 1\nunmatched_tier: A\ntiers:\n  A:\n    paths: ['**']\n    requires: [L]\ncommands: {}\n")
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**

## Rollback
flag
`)
    const r = rda(root, ["red"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("policy has no command for test_file")
    expect(r.out).not.toContain("at ") // no stack trace
  })
})

describe("I3 — gate fast records Gfast so tier C's commit-check can complete", () => {
  it("a docs-only feature: gate fast PASSes and is recorded; commit-check then goes green", () => {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), [
      "version: 1",
      "unmatched_tier: A",
      "tiers:",
      "  A:",
      "    paths: ['nomatch/**']",
      "    requires: [L]",
      "  C:",
      "    paths: ['docs/**']",
      "    requires: [Gfast, C]",
      "commands:",
      "  typecheck: 'true'",
      "  test_related: 'true'",
      "critic:",
      "  required_for_tiers: []",
      "meta_class: []",
      "",
    ].join("\n"))
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- docs/**

## Rollback
flag
`)
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m scaffold", { cwd: root })
    fs.writeFileSync(path.join(root, "docs/notes.md"), "notes\n") // something to gate — an empty diff is NOT_EVALUATED (I6)

    const g = rda(root, ["gate", "fast"])
    expect(g.code).toBe(0)
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(0)
  })
})

describe("C1 — commit-check binds to the working tree, not only the spec digest", () => {
  it("a full green cycle goes green; editing a src file afterward makes commit-check exit 1, stale tree", () => {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), [
      "version: 1",
      "unmatched_tier: A",
      "tiers:",
      "  A:",
      "    paths: ['**']",
      "    requires: [L, R, Gfull]",
      "commands:",
      "  typecheck: none", "  build: 'true'",
      "  test_all: 'true'",
      "  test_file: 'node test-fail.mjs'",
      "failure_classes:",
      "  assertion: ['^\\s*AssertionError']",
      "  load: ['Cannot find module', 'SyntaxError']",
      "critic:",
      "  required_for_tiers: []",
      "meta_class: []",
      "",
    ].join("\n"))
    fs.writeFileSync(path.join(root, "test-fail.mjs"), "console.log('AssertionError: expected'); process.exit(1)\n")
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**
- test/**

## Rollback
flag
`)
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1\n")
    // Settle the working tree before gating — lock/red/gate-full must all see the SAME tree
    // for a truly "full green cycle"; only the ledger (gates.json) is allowed to keep moving.
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m scaffold", { cwd: root })

    expect(rda(root, ["lock"]).code).toBe(0)
    expect(rda(root, ["red"]).code).toBe(0)
    expect(rda(root, ["gate", "full"]).code).toBe(0)
    expect(rda(root, ["commit-check"]).code).toBe(0)

    fs.appendFileSync(path.join(root, "src/a.ts"), "\nexport const b = 2\n")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out.toLowerCase()).toContain("stale tree")
  })
})

describe("I8 — gate full diffText mirrors changedPaths' staged-is-truth rule", () => {
  it("a staged .only file with clean unstaged state is flagged exactly once, not twice", () => {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"),
      "version: 1\nunmatched_tier: A\ntiers:\n  A:\n    paths: ['**']\n    requires: [Gfull]\ncommands:\n  typecheck: none\n  build: 'true'\n  test_all: 'true'\ncritic:\n  required_for_tiers: []\nmeta_class: []\n")
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- test/**

## Rollback
flag
`)
    fs.mkdirSync(path.join(root, "test"), { recursive: true })
    fs.writeFileSync(path.join(root, "test/a.test.ts"), "it.only(\"x\", () => {})\n")
    execSync("git add .", { cwd: root })
    const r = rda(root, ["gate", "full"])
    const onlyMentions = r.out.split("\n").filter((l) => l.includes(".only")).length
    expect(onlyMentions).toBe(1)
  })
})

describe("I1 — global try/catch in bin/gatectl.mjs", () => {
  it("a tampered ledger makes commit-check exit 2 with NOT_EVALUATED, no stack trace", () => {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**

## Rollback
flag
`)
    // Something real in the ledger first, then edited by hand the way a worker agent would.
    rda(root, ["gate", "fast"])
    const ledger = path.join(stateFeatureDir(root, "f1"), "gates.jsonl")
    const line = JSON.parse(fs.readFileSync(ledger, "utf8").trim().split("\n")[0])
    line.entry.status = "PASS"
    fs.writeFileSync(ledger, JSON.stringify(line) + "\n")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("NOT_EVALUATED")
    expect(r.out).toContain("not trustworthy")
    expect(r.out).not.toContain("at ") // no stack trace frames leaking to the user
  })

  it("a pre-0.7 in-repo gates.json is named and ignored, never read as a green", () => {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**

## Rollback
flag
`)
    fs.writeFileSync(path.join(root, "docs/specs/f1/gates.json"), JSON.stringify(
      [{ gate: "L", status: "PASS", digest: "whatever", at: "t" }]))
    const r = rda(root, ["commit-check"])
    expect(r.out).toContain("pre-0.7")
    expect(r.code).toBe(1)
    expect(r.out).toContain("never ran for this feature")
  })
})

// The documented protocol order — lock and red run BEFORE the implementation exists, gate full
// runs after it — necessarily spans two different working trees. Gate C must still be reachable.
describe("C5 — the documented protocol order reaches a green commit-check", () => {
  const TIER_B_POLICY = [
    "version: 1",
    "unmatched_tier: A",
    "tiers:",
    "  A:",
    "    paths: ['supabase/**']",
    "    requires: [L, R, Gfull, C]",
    "  B:",
    "    paths: ['src/**', 'test/**']",
    "    requires: [L, R, Gfull, C]",
    "commands:",
    "  typecheck: none", "  build: 'true'",
    "  test_all: 'true'",
    "  test_file: 'node red-if-missing.mjs {file}'",
    "failure_classes:",
    "  assertion: ['^\\s*AssertionError']",
    "  load: ['Cannot find module', 'SyntaxError']",
    "critic:",
    "  required_for_tiers: []",
    "meta_class: []",
    "",
  ].join("\n")

  const SPEC = `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**
- test/**

## Rollback
flag
`

  const RUNNER = [
    'import fs from "node:fs"',
    'if (fs.existsSync("src/impl.ts")) process.exit(0)',
    'console.log("AssertionError: expected")',
    "process.exit(1)",
    "",
  ].join("\n")

  function scaffold() {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), TIER_B_POLICY)
    fs.writeFileSync(path.join(root, "red-if-missing.mjs"), RUNNER)
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), SPEC)
    fs.mkdirSync(path.join(root, "test"), { recursive: true })
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), "// asserts greet\n")
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m scaffold", { cwd: root })
    return root
  }
  const implement = (root) => {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/impl.ts"), "export const impl = 1\n")
  }

  it("lock and red before the implementation, gate full after it, then commit-check exits 0", () => {
    const root = scaffold()
    expect(rda(root, ["lock"]).code).toBe(0)
    expect(rda(root, ["red"]).code).toBe(0)
    implement(root)
    expect(rda(root, ["gate", "full"]).code).toBe(0)
    const r = rda(root, ["commit-check"])
    expect(r.out).not.toContain("stale")
    expect(r.code).toBe(0)
  })

  it("editing a required test file after RED makes gate R stale, exit 1", () => {
    const root = scaffold()
    rda(root, ["lock"])
    rda(root, ["red"])
    implement(root)
    rda(root, ["gate", "full"])
    fs.appendFileSync(path.join(root, "test/f1.test.ts"), "// weakened after RED\n")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out.toLowerCase()).toContain("stale")
    expect(r.out).toContain("R")
  })

  it("editing the implementation after gate full still makes gate Gfull stale, exit 1", () => {
    const root = scaffold()
    rda(root, ["lock"])
    rda(root, ["red"])
    implement(root)
    rda(root, ["gate", "full"])
    expect(rda(root, ["commit-check"]).code).toBe(0)
    fs.appendFileSync(path.join(root, "src/impl.ts"), "export const sneak = 2\n")
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out.toLowerCase()).toContain("stale tree")
  })
})

// `gatectl export` publishes a delivery record. --dry-run must be complete enough to review by eye
// without a server, and must reach no network at all — the point of the flag.
describe("gatectl export", () => {
  let root
  beforeEach(() => {
    root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"),
      "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.mkdirSync(path.join(root, "docs/specs/f1"), { recursive: true })
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
export the delivery record

## Invariants
- I1 no gate reads memory

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**

## Rollback
flag
`)
    fs.writeFileSync(path.join(root, "docs/specs/ACTIVE"), "f1\n")
  })

  it("--dry-run prints the page and exits 0 with no memory configured and no server", () => {
    const r = rda(root, ["export", "--dry-run"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("ref: gatectl/f1.md")
    expect(r.out).toContain("# f1")
    expect(r.out).toContain("export the delivery record")
    expect(r.out).toContain("no gate reads memory")
    expect(r.out).toContain("tier: B")
  })

  it("carries the gate ledger's latest outcome per gate", () => {
    // Written through the signed ledger, because that is now the only way anything gets in.
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. HIGH — x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"),
      fs.readFileSync(path.join(root, "docs/specs/f1/spec.md"), "utf8") + "\nBLOCKING: unresolved?\n")
    expect(rda(root, ["lock"]).code).toBe(1) // records nothing: gate L failed
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"),
      fs.readFileSync(path.join(root, "docs/specs/f1/spec.md"), "utf8").replace("\nBLOCKING: unresolved?\n", ""))
    expect(rda(root, ["lock"]).code).toBe(0)
    const r = rda(root, ["export", "--dry-run"])
    expect(r.out).toContain("| L | PASS |")
  })

  it("exits 2, naming what is missing, when asked to actually publish unconfigured", () => {
    const r = rda(root, ["export"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("memory")
  })

  it("exits 2 with no active feature", () => {
    fs.rmSync(path.join(root, "docs/specs/ACTIVE"))
    expect(rda(root, ["export", "--dry-run"]).code).toBe(2)
  })
})

// Automatic export: a post-commit hook publishes after the commit, which is after commit-check
// has had its say — so it can neither block a commit nor influence a gate.
describe("gatectl init --with-hooks", () => {
  it("installs an executable post-commit hook that cannot fail a commit", () => {
    const root = makeRepo()
    const r = rda(root, ["init", "--with-hooks"])
    expect(r.code).toBe(0)
    const hook = path.join(root, ".git/hooks/post-commit")
    expect(fs.existsSync(hook)).toBe(true)
    const body = fs.readFileSync(hook, "utf8")
    expect(body).toContain("gatectl export")
    expect(body).toContain("|| true")
    expect(fs.statSync(hook).mode & 0o111).toBeTruthy()
  })

  it("installs no hook without the flag — a git hook is the target's own territory", () => {
    const root = makeRepo()
    rda(root, ["init"])
    expect(fs.existsSync(path.join(root, ".git/hooks/post-commit"))).toBe(false)
  })

  it("never overwrites a post-commit hook the target already has", () => {
    const root = makeRepo()
    const hook = path.join(root, ".git/hooks/post-commit")
    fs.writeFileSync(hook, "#!/bin/sh\necho mine\n", { mode: 0o755 })
    const r = rda(root, ["init", "--with-hooks"])
    expect(r.out).toContain("already exists")
    expect(fs.readFileSync(hook, "utf8")).toContain("echo mine")
  })

  it("the installed hook leaves a commit succeeding when memory is unreachable", () => {
    const root = makeRepo()
    rda(root, ["init", "--with-hooks"])
    fs.writeFileSync(path.join(root, "f.txt"), "x")
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m x", { cwd: root })
    expect(execSync("git log --oneline", { cwd: root, encoding: "utf8" })).toContain("x")
  })
})

// init writes commands read out of the target's own manifests. The value is that a fresh target
// is runnable without hand-editing; the safety is that anything undetected stays commented out.
describe("gatectl init — toolchain detection", () => {
  const withPkg = (pkg, extra = {}) => {
    const root = makeRepo()
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg))
    for (const [name, body] of Object.entries(extra)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
      fs.writeFileSync(path.join(root, name), body)
    }
    execSync("git add -A", { cwd: root })
    return root
  }

  it("writes real commands for a pnpm + vitest + typescript target", () => {
    const root = withPkg(
      { scripts: { build: "next build", test: "vitest run" }, devDependencies: { vitest: "^4", typescript: "^5" } },
      { "pnpm-lock.yaml": "lockfileVersion: 9\n", "src/a.ts": "export const a = 1\n" })
    const r = rda(root, ["init"])
    expect(r.code).toBe(0)
    const policy = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    expect(policy).toContain('build: "pnpm run build"')
    expect(policy).toContain('test_file: "npx vitest run {file}"')
    expect(policy).toContain('typecheck: "npx tsc --noEmit"')
    expect(r.out).toContain("pnpm")
  })

  it("comments out what it could not detect instead of shipping a guess", () => {
    const root = withPkg({ name: "bare" }, { "src/a.js": "1\n" })
    rda(root, ["init"])
    const policy = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    expect(policy).toMatch(/#\s*test_file:/)
    expect(policy).toContain("NOT_EVALUATED")
  })

  // Reported, never edited. A pattern deleted at init is a tier downgrade the day the repo grows
  // into it, with nothing announcing the change.
  it("reports tier patterns matching nothing but leaves every one of them in place", () => {
    const root = withPkg({ devDependencies: { vitest: "^4" } }, { "src/a.js": "1\n", "docs/a.md": "x\n" })
    const r = rda(root, ["init"])
    const policy = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    expect(policy).toContain("supabase/migrations/**")
    expect(r.out).toContain("match nothing here yet")
    expect(r.out).toContain("left in place")
  })

  it("still produces a policy rda itself can open, with an explicit fast workflow", () => {
    const root = withPkg({ devDependencies: { vitest: "^4" } }, { "src/a.js": "1\n" })
    rda(root, ["init"])
    const policy = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    expect(policy).toContain("requires: [Gfull, X]")
    expect(rda(root, ["status"]).code).toBe(0)
  })

  it("leaves an existing policy alone — detection never rewrites a target's decisions", () => {
    const root = withPkg({ devDependencies: { vitest: "^4" } }, { "src/a.js": "1\n" })
    rda(root, ["init"])
    const before = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    rda(root, ["init"])
    expect(fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")).toBe(before)
  })
})

// #4 and #6, end to end. Both holes are only visible when the CLI runs against a real git
// repository: one is about what git will put in the commit, the other about what the diff
// actually touched.
describe("#4/#6 — the commit is the index, and the diff sets the tier", () => {
  const POLICY = [
    "version: 1",
    "unmatched_tier: A",
    "tiers:",
    "  A:",
    "    paths: ['src/app/api/**']",
    "    requires: [L, R, Gfull, C]",
    "  B:",
    "    paths: ['src/**', 'test/**']",
    "    requires: [L, R, Gfull, C]",
    "commands:",
    "  typecheck: none", "  build: 'true'",
    "  test_all: 'true'",
    "  test_file: 'node red-if-missing.mjs {file}'",
    "failure_classes:",
    "  assertion: ['^\\s*AssertionError']",
    "  load: ['Cannot find module', 'SyntaxError']",
    "critic:",
    "  required_for_tiers: []",
    "meta_class: ['.gatectl/**']",
    "",
  ].join("\n")

  const SPEC = `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**
- test/**

## Rollback
flag
`

  const RUNNER = [
    'import fs from "node:fs"',
    'if (fs.existsSync("src/impl.ts") || fs.existsSync("src/app/api/route.ts")) process.exit(0)',
    'console.log("AssertionError: expected")',
    "process.exit(1)",
    "",
  ].join("\n")

  const git = (root, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root })

  function scaffold() {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY)
    fs.writeFileSync(path.join(root, "red-if-missing.mjs"), RUNNER)
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), SPEC)
    fs.mkdirSync(path.join(root, "test"), { recursive: true })
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), "// asserts greet\n")
    git(root, "add -A")
    git(root, "commit -q -m scaffold")
    return root
  }

  const write = (root, rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body)
  }

  it("#6: a tier-A path under a tier-B glob escalates the tier and invalidates the lock", () => {
    const root = scaffold()
    expect(rda(root, ["lock"]).code).toBe(0) // locked at B: allowed_paths say src/**, test/**
    rda(root, ["red"])
    write(root, "src/app/api/route.ts", "export const route = 1\n") // still inside src/**, but tier A
    rda(root, ["gate", "full"])
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("tier escalated B → A")
    expect(r.out).toContain("re-lock")
  })

  it("#6: status reports the escalation before commit-check does", () => {
    const root = scaffold()
    rda(root, ["lock"])
    write(root, "src/app/api/route.ts", "export const route = 1\n")
    const r = rda(root, ["status"])
    expect(r.out).toContain("tier: A")
    expect(r.out).toContain("declared B")
  })

  it("#4: a fully staged green cycle passes, and binds to the tree the commit will carry", () => {
    const root = scaffold()
    rda(root, ["lock"])
    rda(root, ["red"])
    write(root, "src/impl.ts", "export const impl = 1\n")
    git(root, "add -A")
    expect(rda(root, ["gate", "full"]).code).toBe(0)
    expect(rda(root, ["commit-check"]).code).toBe(0)
    // The attestation names the tree it was earned over; the commit carries exactly that tree.
    const att = attestationOf(root, "f1")
    git(root, "commit -q -m impl")
    expect(execSync("git rev-parse HEAD^{tree}", { cwd: root, encoding: "utf8" }).trim()).toBe(att.tree)
  })

  it("#4: editing a file after staging FAILs — the suite ran against bytes the commit will not carry", () => {
    const root = scaffold()
    rda(root, ["lock"])
    rda(root, ["red"])
    write(root, "src/impl.ts", "export const impl = 1\n")
    git(root, "add -A")
    rda(root, ["gate", "full"])
    fs.appendFileSync(path.join(root, "src/impl.ts"), "\nexport const sneak = 2\n") // unstaged
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("drifted from the index")
    expect(r.out).toContain("src/impl.ts")
  })

  it("#4: an untracked file present while the suite ran is drift too", () => {
    const root = scaffold()
    rda(root, ["lock"])
    rda(root, ["red"])
    write(root, "src/impl.ts", "export const impl = 1\n")
    git(root, "add -A")
    rda(root, ["gate", "full"])
    write(root, "src/helper.ts", "export const h = 1\n") // never staged: absent from the commit
    const r = rda(root, ["commit-check"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("src/helper.ts")
  })

  it("#4: the ledger's own growth is never drift", () => {
    const root = scaffold()
    rda(root, ["lock"])
    rda(root, ["red"])
    write(root, "src/impl.ts", "export const impl = 1\n")
    git(root, "add -A")
    rda(root, ["gate", "full"]) // appends to gates.json, which is untracked at this point
    const r = rda(root, ["commit-check"])
    expect(r.out).not.toContain("drifted")
    expect(r.code).toBe(0)
  })
})

// #1 — the authority split. The ledger, the attestation and the key live outside the repository
// the agent edits, and `gatectl verify` re-derives every digest from a commit rather than believing
// anything rda wrote. This is the half a CI job can run without trusting the developer machine.
describe("#1 — attestation and independent verification", () => {
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
    "failure_classes:",
    "  assertion: ['^\\s*AssertionError']",
    "  load: ['Cannot find module', 'SyntaxError']",
    "critic:",
    "  required_for_tiers: []",
    "meta_class: ['.gatectl/**']",
    "",
  ].join("\n")

  const SPEC = `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**
- test/**

## Rollback
flag
`
  // A stand-in test runner: RED while the implementation is absent, GREEN once it lands —
  // exactly how a real required test behaves across the implement step.
  // The same feature said in the form the compiler reads. Every case below used to delete this
  // file and fall back to Markdown, so `verify` — which hashed spec.md unconditionally — was
  // never once asked about a compiled spec. It reported forged on honest work, and the suite
  // stayed green because nothing walked this path to the end.
  const SPEC_YAML = [
    "id: f1",
    "state: DRAFT",
    "mvp_ref: works",
    "intent: |",
    "  x",
    "invariants:",
    "  - id: INV-01",
    "    statement: x",
    "acceptance_criteria:",
    "  - id: AC-01",
    "    statement: x",
    "    test:",
    "      file: test/f1.test.ts",
    "      expected_red: assertion",
    "allowed_paths:",
    "  - src/**",
    "  - test/**",
    "rollback:",
    "  strategy: flag",
    "  notes: null",
    "blocking_questions: []",
    "",
  ].join("\n")

  const RUNNER = [
    'import fs from "node:fs"',
    'if (fs.existsSync("src/impl.ts")) process.exit(0)',
    'console.log("AssertionError: expected")',
    "process.exit(1)",
    "",
  ].join("\n")

  const git = (root, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root })

  function greenCommit(specForm = "md") {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY)
    fs.writeFileSync(path.join(root, "red-if-missing.mjs"), RUNNER)
    rda(root, ["new", "f1"])
    if (specForm === "md") {
      fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true })
      fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), SPEC)
    } else {
      fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"), SPEC_YAML)
    }
    fs.mkdirSync(path.join(root, "test"), { recursive: true })
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), "// asserts\n")
    git(root, "add -A"); git(root, "commit -q -m scaffold")
    const baseSha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()
    rda(root, ["lock"])
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/impl.ts"), "export const impl = 1\n")
    git(root, "add -A")
    // RED replayed against the base, GREEN on the tree in front of us: the two halves the
    // Completion Authority insists on, collected the way the protocol collects them.
    rda(root, ["red", "--base", baseSha])
    rda(root, ["green"])
    expect(rda(root, ["gate", "full"]).code).toBe(0)
    expect(rda(root, ["commit-check"]).code).toBe(0)
    git(root, "commit -q -m impl")
    return root
  }

  it("the ledger is not in the repository at all", () => {
    const root = greenCommit()
    expect(fs.existsSync(path.join(root, "docs/specs/f1/gates.json"))).toBe(false)
    expect(execSync("git status --short", { cwd: root, encoding: "utf8" }).trim()).toBe("")
    expect(fs.existsSync(path.join(stateFeatureDir(root, "f1"), "gates.jsonl"))).toBe(true)
  })

  it("verify PASSes for the commit the attestation was earned on", () => {
    const root = greenCommit()
    const r = rda(root, ["verify", "--commit", "HEAD"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("PASS")
    expect(r.out).toContain("green over this exact tree")
  })

  it("verify PASSes for a compiled spec.yaml, the form the gates actually read", () => {
    // Not a duplicate of the case above: the digest under a Markdown spec is a hash of the file's
    // bytes, and under spec.yaml it is the digest of the compiled canonical form. A verifier that
    // reads the wrong one calls a real green a forgery, which is the failure that costs the most
    // trust — nobody keeps using a verifier that accuses them.
    const root = greenCommit("yaml")
    expect(fs.existsSync(path.join(root, "docs/specs/f1/spec.yaml"))).toBe(true)
    const r = rda(root, ["verify", "--commit", "HEAD"])
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain("green over this exact tree")
  })

  it("hashes a spec.yaml by its compiled form, not by the bytes on disk", () => {
    // The pin under AC-01: that case would also pass if verify and the gates agreed on some OTHER
    // shared function, so the digest is compared against the compiler's own answer here, and
    // against the raw-byte hash it must NOT be.
    const root = greenCommit("yaml")
    const att = JSON.parse(fs.readFileSync(path.join(stateFeatureDir(root, "f1"), "attestation.json"), "utf8"))
    const yamlText = fs.readFileSync(path.join(root, "docs/specs/f1/spec.yaml"), "utf8")
    expect(att.spec_digest).toBe(compileSpec(yaml.load(yamlText)).digest)
    expect(att.spec_digest).not.toBe(specDigest(yamlText))
  })

  it("verifies a commit by the spec IN it, ignoring whatever the working tree says now", () => {
    // `verify --commit <sha>` answers a question about a commit. An edit sitting unstaged beside
    // it is not part of that commit and must not change the answer — otherwise the verdict would
    // depend on the machine it was asked on.
    const root = greenCommit("yaml")
    const p = path.join(root, "docs/specs/f1/spec.yaml")
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("statement: x", "statement: rewritten, uncommitted"))
    const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()
    const r = rda(root, ["verify", "--commit", head])
    expect(r.code, r.out).toBe(0)
  })

  it("REFUSES a commit whose spec.yaml no longer matches the digest that was attested", () => {
    // Committing the rewrite moves the tree as well, so the tree mismatch alone could produce a
    // refusal and prove nothing about the spec. The spec reason is asserted specifically.
    const root = greenCommit("yaml")
    const p = path.join(root, "docs/specs/f1/spec.yaml")
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("statement: x", "statement: something else entirely"))
    git(root, "add -A"); git(root, "commit -q -m 'quietly widen the promise'")
    const r = rda(root, ["verify", "--commit", "HEAD"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("not the spec that was gated")
  })

  it("REFUSES rather than trusting the attestation when the spec at the commit does not compile", () => {
    // The digest cannot be derived independently here. Falling back to the attestation's own
    // spec_digest would have it certify itself.
    const root = greenCommit("yaml")
    const p = path.join(root, "docs/specs/f1/spec.yaml")
    fs.writeFileSync(p, "acceptance_criteria: [{id: AC-01}]\nthis is: [not, a, valid, spec\n")
    git(root, "add -A"); git(root, "commit -q -m 'break the spec'")
    const r = rda(root, ["verify", "--commit", "HEAD"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("does not compile")
  })

  it("REFUSES replay onto a later commit — a green is for one tree, not for a branch", () => {
    const root = greenCommit()
    fs.appendFileSync(path.join(root, "src/impl.ts"), "export const sneak = 2\n")
    git(root, "add -A"); git(root, "commit -q -m sneak")
    const r = rda(root, ["verify", "--commit", "HEAD"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("not this commit's tree")
  })

  it("REFUSES an edited attestation — the signature is checked before anything else", () => {
    const root = greenCommit()
    const p = path.join(stateFeatureDir(root, "f1"), "attestation.json")
    const att = JSON.parse(fs.readFileSync(p, "utf8"))
    att.gates.push({ gate: "X", status: "PASS", at: "t" })
    fs.writeFileSync(p, JSON.stringify(att))
    const r = rda(root, ["verify", "--commit", "HEAD"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("signature does not verify")
  })

  it("REFUSES verification under a different key", () => {
    const root = greenCommit()
    const r = rda(root, ["verify", "--commit", "HEAD"], { GATECTL_ATTEST_KEY: "a-completely-different-key" })
    expect(r.code).toBe(1)
    expect(r.out).toContain("signature")
  })

  it("exits 2, not 0, when no key is available — a missing key is never a pass", () => {
    const root = greenCommit()
    const empty = `${root}-otherstate`
    fs.mkdirSync(empty, { recursive: true })
    const att = path.join(stateFeatureDir(root, "f1"), "attestation.json")
    const r = rda(root, ["verify", "--commit", "HEAD", "--attestation", att], { GATECTL_STATE_DIR: empty })
    expect(r.code).toBe(2)
    expect(r.out).toContain("no signing key")
  })

  it("REFUSES when the policy at the commit requires a gate the attestation does not carry", () => {
    // The requirement is re-derived from the committed policy, so tightening it invalidates an
    // older green rather than being quietly satisfied by it.
    const root = greenCommit()
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY.replace("    requires: [L, R, Gfull]\n  B:", "    requires: [L, R, Gfull]\n  B:"))
    const tightened = POLICY.replace("  B:\n    paths: ['src/**', 'test/**']\n    requires: [L, R, Gfull]",
                                     "  B:\n    paths: ['src/**', 'test/**']\n    requires: [L, R, Gfull, X]")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), tightened)
    git(root, "add -A"); git(root, "commit -q -m tighten")
    const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()
    const r = rda(root, ["verify", "--commit", head])
    expect(r.code).toBe(1)
  })

  // Independent verification: not "the signature matches" but "the gates still say yes", run
  // against a detached worktree at that commit so nothing about the current checkout can leak in.
  it("--rerun reports executed commands without claiming full policy gates", () => {
    const root = greenCommit()
    const r = rda(root, ["verify", "--commit", "HEAD", "--base", "HEAD", "--rerun", "--evidence", `${root}-ev.json`])
    expect(r.code).toBe(0)
    expect(r.out).toContain("re-ran full suite: exit 0")
    expect(r.out).toContain("full policy gates were not re-evaluated")
    const ev = JSON.parse(fs.readFileSync(`${root}-ev.json`, "utf8"))
    expect(ev.not_rerun).toEqual(["L", "R", "Gfull"])
    expect(ev.gates).toEqual({ Build: "PASS", TestSuite: "PASS" })
  })

  it("--rerun FAILs when the committed tree does not actually pass, whatever the attestation says", () => {
    const root = greenCommit()
    // The suite the policy names now fails. The attestation is untouched and still verifies —
    // which is exactly the case a signature check alone cannot catch.
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"),
      fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8").replace("test_all: 'true'", "test_all: 'false'"))
    git(root, "add -A"); git(root, "commit -q -m weaken")
    const att = path.join(stateFeatureDir(root, "f1"), "attestation.json")
    const parent = execSync("git rev-parse HEAD~1", { cwd: root, encoding: "utf8" }).trim()
    expect(rda(root, ["verify", "--commit", parent, "--attestation", att]).code).toBe(0) // signature still fine
    // …and at the weakened commit the re-run says no.
    const r = rda(root, ["verify", "--commit", "HEAD", "--attestation", att, "--rerun"])
    expect(r.code).toBe(1)
  })

  it("--rerun leaves no worktree behind", () => {
    const root = greenCommit()
    rda(root, ["verify", "--commit", "HEAD", "--rerun"])
    expect(execSync("git worktree list", { cwd: root, encoding: "utf8" }).trim().split("\n")).toHaveLength(1)
  })

  it("the attestation records the environment that produced it", () => {
    const root = greenCommit()
    const att = attestationOf(root, "f1")
    expect(att.env.node).toBe(process.versions.node)
    expect(att.env.commands.test_all).toBe("true")
    expect(att.env.digest).toMatch(/^[0-9a-f]{16}$/)
  })

  // The Completion Authority: a different question from commit-check. Not "is this change safe
  // to record" but "is what the spec promised actually delivered".
  it("complete ACCEPTs when every criterion's test is green over the attested tree", () => {
    const root = greenCommit()
    const r = rda(root, ["complete"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("completion: ACCEPT")
    const rec = JSON.parse(fs.readFileSync(path.join(stateFeatureDir(root, "f1"), "completion.json"), "utf8"))
    expect(rec.decision).toBe("ACCEPT")
    expect(rec.authority).toBe("deterministic_policy_engine")
    expect(rec.mac).toMatch(/^[0-9a-f]{64}$/)
    expect(rec.obligations[0].criterion).toBe("AC1")
    expect(rec.evidence.red.base).toBeTruthy()
  })

  it("complete REJECTs when the criterion's test stops passing, naming the predicate", () => {
    const root = greenCommit()
    fs.rmSync(path.join(root, "src/impl.ts")) // the thing the required test proves is gone
    git(root, "add -A")
    const r = rda(root, ["complete"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("completion: REJECT")
    expect(r.out).toContain("green_proven")
  })

  it("complete REJECTs when the attestation is for another tree — a quoted green is still replay", () => {
    const root = greenCommit()
    fs.appendFileSync(path.join(root, "src/impl.ts"), "export const later = 2\n")
    git(root, "add -A")
    const r = rda(root, ["complete"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("attested_for_this_tree")
  })

  it("complete records its decision in the signed ledger, REJECT included", () => {
    const root = greenCommit()
    rda(root, ["complete"])
    const lines = fs.readFileSync(path.join(stateFeatureDir(root, "f1"), "gates.jsonl"), "utf8").trim().split("\n")
    const last = JSON.parse(lines[lines.length - 1]).entry
    expect(last.gate).toBe("Complete")
    expect(last.status).toBe("PASS")
  })

  it("complete answers 2, never a decision, when the ledger cannot be trusted", () => {
    const root = greenCommit()
    const ledger = path.join(stateFeatureDir(root, "f1"), "gates.jsonl")
    const lines = fs.readFileSync(ledger, "utf8").trim().split("\n")
    fs.writeFileSync(ledger, lines.slice(1).join("\n") + "\n") // drop the first entry
    const r = rda(root, ["complete"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("not trustworthy")
  })

  it("exits 2 on a commit that carries no spec for the attested feature", () => {
    const root = greenCommit()
    const first = execSync("git rev-list --max-parents=0 HEAD", { cwd: root, encoding: "utf8" }).trim()
    const r = rda(root, ["verify", "--commit", first])
    expect(r.code).toBe(2)
  })
})

describe("#1 — the pre-commit hook refuses an ungated commit", () => {
  const hookRunnable = (root) => {
    const hook = path.join(root, ".git/hooks/pre-commit")
    fs.writeFileSync(hook, fs.readFileSync(hook, "utf8")
      .replace("gatectl commit-check", `GATECTL_STATE_DIR=${stateFor(root)} node ${BIN} commit-check`), { mode: 0o755 })
  }

  it("blocks a commit while gate C is red, and says why", () => {
    const root = makeRepo()
    rda(root, ["init", "--with-hooks"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    rda(root, ["new", "f1"])
    fs.rmSync(path.join(root, "docs/specs/f1/spec.yaml"), { force: true }) // Markdown path under test
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.md"), `# f1

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
- AC1 x — required: test/f1.test.ts

## Allowed Paths
- src/**

## Rollback
flag
`)
    hookRunnable(root)
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1\n")
    execSync("git add -A", { cwd: root })
    let failed = false
    let out = ""
    try {
      execSync("git -c user.email=t@t -c user.name=t commit -q -m nope", { cwd: root, encoding: "utf8", stdio: "pipe" })
    } catch (e) { failed = true; out = `${e.stdout ?? ""}${e.stderr ?? ""}` }
    expect(failed).toBe(true)
    expect(out).toContain("commit refused")
    expect(execSync("git log --oneline", { cwd: root, encoding: "utf8" })).not.toContain("nope")
  })

  it("stands aside when no feature is ACTIVE — it gates features, not the repository", () => {
    const root = makeRepo()
    rda(root, ["init", "--with-hooks"])
    hookRunnable(root)
    fs.writeFileSync(path.join(root, "unrelated.txt"), "x")
    execSync("git add -A", { cwd: root })
    execSync("git -c user.email=t@t -c user.name=t commit -q -m unrelated", { cwd: root })
    expect(execSync("git log --oneline", { cwd: root, encoding: "utf8" })).toContain("unrelated")
  })
})

// Gate X, end to end. The reviewer is a stub standing in for a second model; what is under test
// is rda's handling of what a model returns — which is the only part rda decides.
describe("gate X — accounting for every promise, with citations", () => {
  const git = (root, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root })

  const POLICY = (reviewerPath, reviewerModel = "reviewer-2") => [
    "version: 1", "unmatched_tier: A",
    "tiers:", "  A:", "    paths: ['src/**', 'test/**']", "    requires: [L, R, Gfull, X]",
    "test_paths: ['test/**']",
    "commands:", "  typecheck: none", "  build: 'true'", "  test_all: 'true'",
    "  test_file: 'node runner.mjs {file}'", "  test_case: 'node runner.mjs {file} {selector}'",
    "failure_classes:", "  assertion: ['^AssertionError']", "  empty: ['no matching test']",
    "critic:", "  required_for_tiers: []", "  model: critic-1",
    "reviewer:", `  cli: ${reviewerPath}`, `  model: ${reviewerModel}`,
    "meta_class: ['.gatectl/**']", "",
  ].join("\n")

  const SPEC = `id: f1
state: DRAFT
mvp_ref: works
intent: |
  x
invariants:
  - id: INV-01
    statement: nothing else changes
acceptance_criteria:
  - id: AC-01
    statement: an expired token is rejected
    test:
      file: test/f1.test.ts
      selector: rejects an expired token
allowed_paths:
  - src/**
  - test/**
rollback:
  strategy: revert
`
  const RUNNER = [
    'import fs from "node:fs"',
    'const s = process.argv[3]',
    'if (s && s !== "rejects an expired token") { console.log("no matching test"); process.exit(0) }',
    'if (fs.existsSync("src/impl.ts")) process.exit(0)',
    'console.log("AssertionError: nope"); process.exit(1)',
    "",
  ].join("\n")

  const IMPL = "export const impl = 1\n"
  const claim = (target, quote = "export const impl = 1") => ({
    target, verdict: "implemented", reasoning: "this is where it happens",
    citations: [{ file: "src/impl.ts", start_line: 1, end_line: 1, quote }],
  })
  const reviewJson = (over = {}) => JSON.stringify({
    prompt_version: 2, model: "reviewer-2",
    claims: [claim("AC-01"), claim("INV-01")],
    findings: [], verdict: "APPROVE", ...over,
  })
  const stub = (json) => `#!/bin/sh\ncat <<'EOF'\n${json}\nEOF\n`

  function scaffold(json = reviewJson()) {
    const root = makeRepo()
    rda(root, ["init"])
    const reviewerPath = path.join(root, "fake-reviewer.sh")
    fs.writeFileSync(reviewerPath, stub(json), { mode: 0o755 })
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY(reviewerPath))
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, "runner.mjs"), RUNNER)
    rda(root, ["new", "f1"])
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"), SPEC)
    fs.mkdirSync(path.join(root, "test"), { recursive: true })
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), "// asserts\n")
    git(root, "add -A"); git(root, "commit -q -m base")
    const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: critic-1\n\n## 1. x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    rda(root, ["lock"]); rda(root, ["red", "--base", sha])
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/impl.ts"), IMPL)
    git(root, "add -A")
    return { root, sha }
  }

  it("the review is written OUTSIDE the repository — a review of a tree must not move that tree", () => {
    const { root } = scaffold()
    const before = execSync("git status --short", { cwd: root, encoding: "utf8" })
    expect(rda(root, ["review"]).code).toBe(0)
    expect(execSync("git status --short", { cwd: root, encoding: "utf8" })).toBe(before)
    expect(fs.existsSync(path.join(stateFeatureDir(root, "f1"), "review.json"))).toBe(true)
  })

  it("PASSes when every criterion and invariant is accounted for, with citations in the diff", () => {
    const { root } = scaffold()
    rda(root, ["review"])
    const r = rda(root, ["gate", "x"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("accounted for 2 criteria/invariants")
  })

  // The rule that replaced "found nothing is not approval": finding nothing is fine, looking at
  // nothing is not.
  it("REFUSES a review that skipped an invariant, even though it found no problems", () => {
    const { root } = scaffold(reviewJson({ claims: [claim("AC-01")] }))
    rda(root, ["review"])
    const r = rda(root, ["gate", "x"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("INV-01 is not addressed")
  })

  it("REFUSES a citation whose quote is not what is there", () => {
    const fabricated = reviewJson({ claims: [claim("AC-01", "export const somethingElse = 2"), claim("INV-01")] })
    const { root } = scaffold(fabricated)
    rda(root, ["review"])
    const r = rda(root, ["gate", "x"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("not what is there")
  })

  it("REFUSES a criterion the reviewer could not confirm", () => {
    const unsure = reviewJson({ claims: [{ ...claim("AC-01"), verdict: "unclear" }, claim("INV-01")] })
    const { root } = scaffold(unsure)
    rda(root, ["review"])
    expect(rda(root, ["gate", "x"]).out).toContain('AC-01: the reviewer says "unclear"')
  })

  it("FAILs on an unresolved high finding, named by its stable id", () => {
    const withFinding = reviewJson({
      verdict: "CHANGES_REQUESTED",
      findings: [{ id: "X-001", severity: "high", title: "expiry uses the wrong clock" }],
    })
    const { root } = scaffold(withFinding)
    rda(root, ["review"])
    const r = rda(root, ["gate", "x"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("X-001 high: expiry uses the wrong clock")
  })

  it("an acceptance recorded in writing clears it, and the reason stays in the ledger", () => {
    const withFinding = reviewJson({
      verdict: "CHANGES_REQUESTED",
      findings: [{ id: "X-001", severity: "high", title: "known gap" }],
    })
    const { root } = scaffold(withFinding)
    rda(root, ["review"])
    expect(rda(root, ["gate", "x"]).code).toBe(1)
    const a = rda(root, ["review", "accept", "X-001", "--reason", "shipping behind a flag, tracked in RSK-42"])
    expect(a.code).toBe(0)
    const r = rda(root, ["gate", "x"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("accepted in writing: X-001")
    const ledger = fs.readFileSync(path.join(stateFeatureDir(root, "f1"), "gates.jsonl"), "utf8")
    expect(ledger).toContain("shipping behind a flag, tracked in RSK-42")
  })

  it("editing the code after the review stales gate X — the review covered another diff", () => {
    const { root } = scaffold()
    rda(root, ["review"])
    expect(rda(root, ["gate", "x"]).code).toBe(0)
    fs.appendFileSync(path.join(root, "src/impl.ts"), "export const sneak = 2\n")
    git(root, "add -A")
    const r = rda(root, ["gate", "x"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("re-run `gatectl review`")
  })

  it("REFUSES a reviewer that answers with prose instead of the structure it was asked for", () => {
    const { root } = scaffold("looks good to me, ship it")
    const r = rda(root, ["review"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("did not return a JSON object")
  })

  it("refuses to run at all without a reviewer block — fail-closed, never a stray CLI", () => {
    const { root } = scaffold()
    const p = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), p.replace(/reviewer:\n.*\n.*\n/, ""))
    const r = rda(root, ["review"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("no `reviewer:` block")
  })

  it("a tier-A feature reaches a green commit-check once X is green", () => {
    const { root } = scaffold()
    rda(root, ["review"])
    expect(rda(root, ["gate", "x"]).code).toBe(0)
    rda(root, ["green"])
    expect(rda(root, ["gate", "full"]).code).toBe(0)
    const c = rda(root, ["commit-check"])
    expect(c.code).toBe(0)
    expect(c.out).toContain("attested tree")
  })
})

// The two-job split, and the correction that makes it worth anything: the signer does not
// believe the evidence. It re-checks every claim against sources the candidate branch cannot
// write — its own CI context, and git — and signs only what survives.
describe("#1 — sandboxed runner, isolated signer", () => {
  const git = (root, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root })

  const POLICY = [
    "version: 1",
    "unmatched_tier: A",
    "tiers:",
    "  A:",
    "    paths: ['src/**']",
    "    requires: [L, R, Gfull]",
    "commands:",
    "  typecheck: none", "  build: 'true'",
    "  test_all: 'true'",
    "  test_file: 'true'",
    "critic:",
    "  required_for_tiers: []",
    "meta_class: ['.gatectl/**']",
    "",
  ].join("\n")

  function repo() {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY)
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1\n")
    git(root, "add -A"); git(root, "commit -q -m base")
    const base = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()
    fs.writeFileSync(path.join(root, "src/b.ts"), "export const b = 2\n")
    git(root, "add -A"); git(root, "commit -q -m work")
    return { root, base, head: execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim() }
  }

  const evidenceOf = (root, name = "ev.json") => path.join(`${root}-ci`, name)
  const runner = (root) => {
    const dir = `${root}-ci`
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  it("the runner produces evidence and is never given the key", () => {
    const { root, base, head } = repo()
    runner(root)
    const out = evidenceOf(root)
    // No GATECTL_SIGNING_KEY in this environment at all — the job that runs repository code cannot
    // leak what it was never handed.
    const r = rda(root, ["verify", "--commit", head, "--base", base, "--rerun", "--evidence", out])
    expect(r.code).toBe(0)
    expect(r.out).toContain("evidence (unsigned)")
    const ev = JSON.parse(fs.readFileSync(out, "utf8"))
    expect(ev.gates).toEqual({ Build: "PASS", TestSuite: "PASS" })
    expect(ev.not_rerun).toEqual([])
    expect(ev.reran).toEqual(["build", "full suite"])
    expect(ev.schema_version).toBe(1)
    expect(ev.head_sha).toBe(head)
    expect(ev.base_sha).toBe(base)
    expect(ev.sig).toBeUndefined()
    expect(ev.rda_binary_digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("--evidence without --base refuses: no base commit, no trusted policy", () => {
    const { root, head } = repo()
    runner(root)
    const r = rda(root, ["verify", "--commit", head, "--rerun", "--evidence", evidenceOf(root)])
    expect(r.code).toBe(2)
    expect(r.out).toContain("trusted policy")
  })

  it("the signer signs evidence that matches the commit", () => {
    const { root, base, head } = repo()
    runner(root); rda(root, ["keygen"])
    const ev = evidenceOf(root)
    rda(root, ["verify", "--commit", head, "--base", base, "--rerun", "--evidence", ev])
    const out = path.join(`${root}-ci`, "issued.json")
    const r = rda(root, ["attest", "--evidence", ev, "--commit", head, "--base", base, "--out", out])
    expect(r.code).toBe(0)
    expect(r.out).toContain("SIGNED")
    expect(r.out).toMatch(/cross-checked:.*head_sha, base_sha/)
    const issued = JSON.parse(fs.readFileSync(out, "utf8"))
    expect(issued.alg).toBe("ed25519")
    expect(issued.signer.envelope_digest).toMatch(/^[0-9a-f]{64}$/)
  })

  // The attack the two-job split alone does not stop.
  it("REFUSES forged evidence: repository code writing its own PASS for another tree", () => {
    const { root, base, head } = repo()
    runner(root); rda(root, ["keygen"])
    const ev = evidenceOf(root)
    rda(root, ["verify", "--commit", head, "--base", base, "--rerun", "--evidence", ev])
    const forged = JSON.parse(fs.readFileSync(ev, "utf8"))
    forged.tree_oid = "9".repeat(40) // a tree this commit does not carry
    fs.writeFileSync(ev, JSON.stringify(forged))
    const r = rda(root, ["attest", "--evidence", ev, "--commit", head, "--base", base])
    expect(r.code).toBe(1)
    expect(r.out).toContain("tree_oid")
  })

  it("REFUSES evidence from another workflow run handed to this signer", () => {
    const { root, base, head } = repo()
    runner(root); rda(root, ["keygen"])
    const ev = evidenceOf(root)
    rda(root, ["verify", "--commit", head, "--base", base, "--rerun", "--evidence", ev],
        { GITHUB_REPOSITORY: "org/repo", GITHUB_RUN_ID: "111", GITHUB_RUN_ATTEMPT: "1" })
    const r = rda(root, ["attest", "--evidence", ev, "--commit", head, "--base", base],
                  { GITHUB_REPOSITORY: "org/repo", GITHUB_RUN_ID: "222", GITHUB_RUN_ATTEMPT: "1" })
    expect(r.code).toBe(1)
    expect(r.out).toContain("workflow_run_id")
  })

  it("REFUSES an envelope carrying a field the signer cannot check", () => {
    const { root, base, head } = repo()
    runner(root); rda(root, ["keygen"])
    const ev = evidenceOf(root)
    rda(root, ["verify", "--commit", head, "--base", base, "--rerun", "--evidence", ev])
    const smuggled = { ...JSON.parse(fs.readFileSync(ev, "utf8")), overall: "PASS" }
    fs.writeFileSync(ev, JSON.stringify(smuggled))
    const r = rda(root, ["attest", "--evidence", ev, "--commit", head, "--base", base])
    expect(r.code).toBe(1)
    expect(r.out).toContain("unknown field: overall")
  })

  // The candidate cannot relax the authority that judges it.
  it("REFUSES a branch that edited the policy judging it, before running anything", () => {
    const { root, base } = repo()
    runner(root)
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY.replace("requires: [L, R, Gfull]", "requires: [Gfull]"))
    git(root, "add -A"); git(root, "commit -q -m 'relax my own gate'")
    const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()
    const r = rda(root, ["verify", "--commit", head, "--base", base, "--rerun", "--evidence", evidenceOf(root)])
    expect(r.code).toBe(2)
    expect(r.out).toContain("modifies its own authority")
  })
})

// spec.yaml is the source of truth; the gates stop guessing at prose.
describe("spec compiler", () => {
  const YAML = (extra = "") => `id: f1
state: DRAFT
mvp_ref: works
intent: |
  Expired refresh tokens must be rejected.
invariants:
  - id: INV-01
    statement: Existing sessions stay valid
acceptance_criteria:
  - id: AC-01
    statement: An expired refresh token is rejected
    test:
      file: test/f1.test.ts
      selector: rejects an expired refresh token
allowed_paths:
  - src/**
  - test/**
rollback:
  strategy: feature flag
${extra}`

  function repo(specYaml = YAML()) {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    rda(root, ["new", "f1"])
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"), specYaml)
    return root
  }

  it("gatectl new scaffolds both the machine-readable spec and the narrative beside it", () => {
    const root = makeRepo()
    rda(root, ["init"])
    const r = rda(root, ["new", "f1"])
    expect(r.out).toContain("spec.yaml")
    expect(fs.existsSync(path.join(root, "docs/specs/f1/spec.yaml"))).toBe(true)
    expect(fs.existsSync(path.join(root, "docs/specs/f1/spec.md"))).toBe(true)
  })

  it("compiles, and prints the obligations the gates will hold it to", () => {
    const r = rda(repo(), ["spec", "compile"])
    expect(r.code).toBe(0)
    expect(r.out).toContain('AC-01 → test/f1.test.ts::"rejects an expired refresh token"')
    expect(r.out).toContain("RED must be assertion")
  })

  it("a criterion with no test is refused at compile time, by every command that needs a spec", () => {
    const root = repo(YAML().replace(/    test:\n      file:.*\n      selector:.*\n/, ""))
    for (const cmd of [["spec", "compile"], ["lock"], ["status"], ["commit-check"]]) {
      const r = rda(root, cmd)
      expect(r.code).toBe(2)
      expect(r.out).toContain("names no test")
    }
  })

  it("says what is wrong with unreadable YAML instead of reporting no active feature", () => {
    const root = repo("id: f1\n  bad indent: [\n")
    const r = rda(root, ["lock"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("not valid YAML")
  })

  // The property the compiler buys: the digest identifies the promise, not the formatting.
  it("reformatting the spec leaves a lock standing; changing a statement does not", () => {
    const root = repo()
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    expect(rda(root, ["lock"]).code).toBe(0)

    // Comments, blank lines and key order move; the promise does not.
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"),
      "# a comment nobody reads\n\n" + YAML() + "\n\n")
    expect(rda(root, ["status"]).out).toContain("(current)")

    // A statement moves, and everything bound to the old digest is stale.
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"),
      YAML().replace("An expired refresh token is rejected", "Any refresh token is rejected"))
    expect(rda(root, ["status"]).out).toContain("STALE")
  })

  it("an open blocking question refuses the lock", () => {
    const root = repo(YAML('blocking_questions:\n  - Which clock do we trust for expiry?\n'))
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    const r = rda(root, ["lock"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("BLOCKING")
  })
})

// Replayable RED: the property that turns "it was red when I looked" into an experiment someone
// else can repeat. Note what these tests do — they prove RED AFTER the implementation exists,
// which is impossible for a gate that only ever judges the working tree.
describe("gate R — replay against base + the test changes", () => {
  const git = (root, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root })

  const POLICY = [
    "version: 1",
    "unmatched_tier: A",
    "tiers:",
    "  A:",
    "    paths: ['src/**', 'test/**']",
    "    requires: [L, R, Gfull]",
    "test_paths: ['test/**']",
    "commands:",
    "  typecheck: none", "  build: 'true'",
    "  test_all: 'true'",
    "  test_file: 'node runner.mjs {file}'",
    "  test_case: 'node runner.mjs {file} {selector}'",
    "failure_classes:",
    "  assertion: ['^AssertionError']",
    "  load: ['Cannot find module']",
    "  empty: ['no matching test']",
    "critic:",
    "  required_for_tiers: []",
    "meta_class: ['.gatectl/**']",
    "",
  ].join("\n")

  const SPEC = `id: f1
state: DRAFT
mvp_ref: works
intent: |
  Expired tokens are rejected.
invariants:
  - id: INV-01
    statement: sessions stay valid
acceptance_criteria:
  - id: AC-01
    statement: an expired token is rejected
    test:
      file: test/f1.test.ts
      selector: rejects an expired token
allowed_paths:
  - src/**
  - test/**
rollback:
  strategy: revert
`

  // Passes only when the implementation is present — the shape of any honest first RED.
  const RUNNER = [
    'import fs from "node:fs"',
    'const selector = process.argv[3]',
    'if (selector && selector !== "rejects an expired token") { console.log("no matching test"); process.exit(0) }',
    'if (fs.existsSync("src/impl.ts")) process.exit(0)',
    'console.log("AssertionError: expected a rejection")',
    "process.exit(1)",
    "",
  ].join("\n")

  function base({ runner = RUNNER, spec = SPEC } = {}) {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY)
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, "runner.mjs"), runner)
    rda(root, ["new", "f1"])
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"), spec)
    git(root, "add -A"); git(root, "commit -q -m base")
    return { root, sha: execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim() }
  }
  const addTest = (root) => {
    fs.mkdirSync(path.join(root, "test"), { recursive: true })
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), "// asserts the rejection\n")
  }
  const addImpl = (root) => {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/impl.ts"), "export const impl = 1\n")
  }

  it("proves RED at base + the test change, and names the tree it used", () => {
    const { root, sha } = base()
    addTest(root)
    const r = rda(root, ["red", "--base", sha])
    expect(r.code).toBe(0)
    expect(r.out).toContain("gate R: PASS")
    expect(r.out).toContain("✓ AC-01")
    expect(r.out).toMatch(/replayed [0-9a-f]{12} \+ 1 test file\(s\) → tree [0-9a-f]{12}/)
  })

  // The property that matters most: this still works once the code exists.
  it("still proves RED after the implementation has landed — the experiment is repeatable", () => {
    const { root, sha } = base()
    addTest(root); addImpl(root)
    const r = rda(root, ["red", "--base", sha])
    expect(r.code).toBe(0)
    expect(r.out).toContain("gate R: PASS")
    // The working tree is green; the replay is red. Both are true, and only one is evidence.
    expect(rda(root, ["red"]).code).toBe(1) // judging the working tree: "already passes"
  })

  it("records per-criterion evidence, not one verdict for the feature", () => {
    const { root, sha } = base()
    addTest(root); addImpl(root)
    rda(root, ["red", "--base", sha])
    const ledger = path.join(stateFeatureDir(root, "f1"), "gates.jsonl")
    const entry = fs.readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l).entry).pop()
    expect(entry.gate).toBe("R")
    expect(entry.criteria).toEqual([
      { criterion: "AC-01", red: { tree: expect.any(String), executed: true, classification: "assertion", ok: true } },
    ])
    expect(entry.replay.base).toBe(sha)
    expect(entry.replay.test_patch).toEqual(["test/f1.test.ts"])
  })

  it("REFUSES a criterion whose test exists neither at the base nor in the diff", () => {
    const { root, sha } = base()
    addImpl(root) // implementation only: the test the criterion names was never written
    const r = rda(root, ["red", "--base", sha])
    expect(r.code).toBe(2)
    expect(r.out).toContain("there is nothing to have been RED")
  })

  it("replays a test that already lived at the base commit, with an empty test patch", () => {
    const { root, sha } = base()
    addTest(root)
    execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m 'test first'", { cwd: root })
    const withTest = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim()
    addImpl(root)
    const r = rda(root, ["red", "--base", withTest])
    expect(r.code).toBe(0)
    expect(r.out).toContain("+ 0 test file(s)")
  })

  it("FAILs when the criterion already passes at the base commit", () => {
    const { root, sha } = base()
    addTest(root); addImpl(root)
    // Test globs wide enough to drag the implementation into the replay: then the experiment
    // proves nothing, and says so rather than going green.
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY.replace("test_paths: ['test/**']", "test_paths: ['test/**', 'src/**']"))
    const r = rda(root, ["red", "--base", sha])
    expect(r.code).toBe(1)
    expect(r.out).toContain("already passes at the base commit")
  })

  it("REFUSES a criterion whose RED is a broken harness rather than the failure it declared", () => {
    const BROKEN = 'console.log("Cannot find module \'./nope\'"); process.exit(1)\n'
    const { root, sha } = base({ runner: BROKEN })
    addTest(root)
    const r = rda(root, ["red", "--base", sha])
    expect(r.code).toBe(2)
    expect(r.out).toContain('declares its RED as "assertion"')
  })

  it("honours a criterion that declares a load-shaped RED", () => {
    const BROKEN = 'console.log("Cannot find module \'./nope\'"); process.exit(1)\n'
    const { root, sha } = base({
      runner: BROKEN,
      spec: SPEC.replace("      selector: rejects an expired token",
        "      selector: rejects an expired token\n      expected_red: load"),
    })
    addTest(root)
    expect(rda(root, ["red", "--base", sha]).code).toBe(0)
  })
})

// `gatectl next` is the command an agent runs when it has lost the thread. The state is derived, so
// it cannot be set by something that merely feels done.
describe("gatectl next", () => {
  const git = (root, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root })
  const POLICY = [
    "version: 1", "unmatched_tier: A",
    "tiers:", "  A:", "    paths: ['src/**', 'test/**']", "    requires: [L, R, Gfull]",
    "test_paths: ['test/**']",
    "commands:", "  typecheck: none", "  build: 'true'", "  test_all: 'true'",
    "  test_file: 'node runner.mjs {file}'", "  test_case: 'node runner.mjs {file} {selector}'",
    "failure_classes:", "  assertion: ['^AssertionError']", "  empty: ['no matching test']",
    "critic:", "  required_for_tiers: []", "meta_class: ['.gatectl/**']", "",
  ].join("\n")
  const SPEC = `id: f1
state: DRAFT
mvp_ref: works
intent: |
  x
invariants:
  - id: INV-01
    statement: y
acceptance_criteria:
  - id: AC-01
    statement: an expired token is rejected
    test:
      file: test/f1.test.ts
      selector: rejects an expired token
allowed_paths:
  - src/**
  - test/**
rollback:
  strategy: revert
`
  const RUNNER = [
    'import fs from "node:fs"',
    'const s = process.argv[3]',
    'if (s && s !== "rejects an expired token") { console.log("no matching test"); process.exit(0) }',
    'if (fs.existsSync("src/impl.ts")) process.exit(0)',
    'console.log("AssertionError: nope"); process.exit(1)',
    "",
  ].join("\n")

  function repo() {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), POLICY)
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    fs.writeFileSync(path.join(root, "runner.mjs"), RUNNER)
    rda(root, ["new", "f1"])
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"), SPEC)
    fs.mkdirSync(path.join(root, "test"), { recursive: true })
    fs.writeFileSync(path.join(root, "test/f1.test.ts"), "// asserts\n")
    git(root, "add -A"); git(root, "commit -q -m base")
    return { root, sha: execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim() }
  }
  const next = (root) => JSON.parse(rda(root, ["next", "--json"]).out)

  it("answers in JSON an agent can branch on", () => {
    const { root } = repo()
    const n = next(root)
    expect(n).toMatchObject({ state: "SPEC_REVIEW", next_command: "gatectl lock" })
    expect(Array.isArray(n.allowed_actions)).toBe(true)
    expect(n.blocking_questions).toEqual([])
  })

  it("walks the protocol one step at a time, and each step is the one that unblocks the next", () => {
    const { root, sha } = repo()
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    expect(next(root).next_command).toBe("gatectl lock")
    rda(root, ["lock"])
    expect(next(root).next_command).toContain("gatectl red --base")
    rda(root, ["red", "--base", sha])
    expect(next(root)).toMatchObject({ state: "RED_PROVEN", allowed_actions: ["implement"] })

    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/impl.ts"), "export const impl = 1\n")
    expect(next(root).next_command).toBe("gatectl green")
    rda(root, ["green"])
    expect(next(root).next_command).toBe("gatectl gate full")
    rda(root, ["gate", "full"])
    expect(next(root).next_command).toBe("gatectl commit-check")
    rda(root, ["commit-check"])
    expect(next(root).next_command).toBe("gatectl complete")
    expect(rda(root, ["complete"]).code).toBe(0)
    expect(next(root)).toMatchObject({ state: "COMPLETED", next_command: null })
  }, 60_000) // the whole protocol, one real CLI invocation per step

  it("falls back on its own when the tree moves — no status is ever written down", () => {
    const { root, sha } = repo()
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. x\nSEVERITY: high\nBody.\nRESOLVED: fixed.\n")
    rda(root, ["lock"]); rda(root, ["red", "--base", sha])
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "src/impl.ts"), "export const impl = 1\n")
    rda(root, ["green"]); rda(root, ["gate", "full"])
    expect(next(root).state).toBe("REVIEWED")
    fs.appendFileSync(path.join(root, "src/impl.ts"), "export const sneak = 2\n")
    expect(next(root)).toMatchObject({ state: "IMPLEMENTING", next_command: "gatectl green" })
  })

  it("a blocking question stops the protocol and offers no command at all", () => {
    const { root } = repo()
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"), SPEC + "blocking_questions:\n  - which clock?\n")
    const n = next(root)
    expect(n).toMatchObject({ state: "BLOCKED", next_command: null })
    expect(n.blocking_questions).toEqual(["which clock?"])
  })
})

// Found by running the protocol on a real feature: two critique runs raced, the second silently
// overwrote the first, and nine hand-written resolutions ended up filed under findings they were
// not about. Losing argued-through work quietly is the failure this engine exists to catch.
describe("gatectl critique — resolutions are not overwritten silently", () => {
  const spec = `id: f1
state: DRAFT
mvp_ref: works
intent: |
  x
invariants:
  - id: INV-01
    statement: y
acceptance_criteria:
  - id: AC-01
    statement: z
    test:
      file: test/f1.test.ts
      selector: does the thing
allowed_paths:
  - src/**
rollback:
  strategy: revert
`
  function repo() {
    const root = makeRepo()
    rda(root, ["init"])
    fs.writeFileSync(path.join(root, ".gatectl/MVP.yaml"), "mvp_done_when:\n  - id: works\n    text: x\nout_of_scope: []\n")
    rda(root, ["new", "f1"])
    fs.writeFileSync(path.join(root, "docs/specs/f1/spec.yaml"), spec)
    return root
  }

  it("refuses to run over a critique that carries resolutions", () => {
    const root = repo()
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. x\nSEVERITY: high\nBody.\nRESOLVED: argued through.\n")
    const r = rda(root, ["critique"])
    expect(r.code).toBe(2)
    expect(r.out).toContain("already carries 1 resolved finding")
    expect(fs.readFileSync(path.join(root, "docs/specs/f1/critique.md"), "utf8")).toContain("RESOLVED: argued through.")
  })

  it("says how to override, and an unresolved critique is not protected", () => {
    const root = repo()
    fs.writeFileSync(path.join(root, "docs/specs/f1/critique.md"),
      "- provider: openai\n- model: m\n\n## 1. x\nSEVERITY: high\nBody.\n")
    // No resolutions to lose: the guard stands aside and the command proceeds to the critic —
    // pointed here at a CLI that fails immediately, so the test exercises the guard and not a
    // model.
    const policy = fs.readFileSync(path.join(root, ".gatectl/policy.yaml"), "utf8")
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), policy.replace(/^critic:\n  cli: .*/m, 'critic:\n  cli: "/usr/bin/false"'))
    const r = rda(root, ["critique"])
    expect(r.out).not.toContain("already carries")
    expect(r.out).toContain("CRITIC_UNAVAILABLE")
  })
})
