import { describe, it, expect } from "vitest"
import { diffChecks, gateGfast, gateGfull } from "../src/core/gates.mjs"

const POLICY = { commands: { typecheck: "tsc", build: "build", test_all: "test", test_related: "rel {files}" },
                 meta_class: [".gatectl/**", "docs/specs/**/spec.lock.json"] }
const SPEC = { allowedPaths: ["src/lib/export/**", "test/**"] }

describe("diffChecks", () => {
  const base = { allowedPaths: SPEC.allowedPaths, specDir: "docs/specs/csv-export", metaClass: POLICY.meta_class }
  it("clean diff yields no reasons", () => {
    expect(diffChecks({ ...base, changed: ["src/lib/export/a.ts", "docs/specs/csv-export/spec.md"], diffText: "" })).toEqual([])
  })
  it("flags a path outside allowed_paths", () => {
    expect(diffChecks({ ...base, changed: ["src/other.ts"], diffText: "" }).join()).toContain("src/other.ts")
  })
  it("flags a meta-class touch even inside allowed paths", () => {
    const r = diffChecks({ ...base, changed: [".gatectl/policy.yaml"], diffText: "" })
    expect(r.join()).toContain("meta-class")
  })
  it("flags a deleted test file", () => {
    const diffText = "diff --git a/test/old.test.ts b/test/old.test.ts\ndeleted file mode 100644\n"
    expect(diffChecks({ ...base, changed: ["test/old.test.ts"], diffText }).join()).toContain("deleted")
  })
  it("flags added .only / .skip", () => {
    const diffText = "diff --git a/test/a.test.ts b/test/a.test.ts\n+  it.only(\"x\", () => {})\n"
    expect(diffChecks({ ...base, changed: ["test/a.test.ts"], diffText }).join()).toContain(".only")
  })
  it("does not flag .skip() on application code in a non-test file", () => {
    const diffText = "diff --git a/src/lib/export/a.ts b/src/lib/export/a.ts\n+ const paged = items.skip(10).take(5);\n"
    expect(diffChecks({ ...base, changed: ["src/lib/export/a.ts"], diffText })).toEqual([])
  })
  it("still flags it.only in a test file", () => {
    const diffText = "diff --git a/test/a.test.ts b/test/a.test.ts\n+  it.only(\"x\", () => {})\n"
    expect(diffChecks({ ...base, changed: ["test/a.test.ts"], diffText }).join()).toContain(".only")
  })
  it("CRLF variant of deleted-test diff is still flagged", () => {
    const diffText = "diff --git a/test/old.test.ts b/test/old.test.ts\r\ndeleted file mode 100644\n"
    expect(diffChecks({ ...base, changed: ["test/old.test.ts"], diffText }).join()).toContain("deleted")
  })
  it("I4: the engine's own spec.lock.json under specDir is allowed, not meta-class-flagged", () => {
    const r = diffChecks({ ...base, changed: ["docs/specs/csv-export/spec.lock.json", "docs/specs/ACTIVE"], diffText: "" })
    expect(r).toEqual([])
  })
})

describe("gateGfast / gateGfull", () => {
  it("Gfast runs typecheck + related and passes on 0/0", () => {
    const calls = []
    const run = (cmd, subst) => { calls.push(cmd); return { code: 0, output: "" } }
    const r = gateGfast({ run, policy: POLICY, changed: ["src/lib/export/a.ts"] })
    expect(r.status).toBe("PASS")
    expect(calls).toEqual(["tsc", "rel {files}"])
  })
  it("Gfast fails when typecheck fails", () => {
    // I6: changed must be non-empty here, or this collides with the new empty-diff
    // NOT_EVALUATED short-circuit and would no longer exercise the typecheck-FAIL path.
    const run = (cmd) => ({ code: cmd === "tsc" ? 1 : 0, output: "TS2322" })
    expect(gateGfast({ run, policy: POLICY, changed: ["src/lib/export/a.ts"] }).status).toBe("FAIL")
  })
  it("Gfull = build + full suite + diff checks", () => {
    const run = () => ({ code: 0, output: "" })
    const r = gateGfull({ run, policy: POLICY, changed: ["src/other.ts"], diffText: "", spec: SPEC, specDir: "docs/specs/csv-export" })
    expect(r.status).toBe("FAIL") // out-of-allowed path fails even with green commands
  })
  it("Gfull NOT_EVALUATED when a command is missing from policy", () => {
    const r = gateGfull({ run: () => ({ code: 0, output: "" }), policy: { commands: {}, meta_class: [] },
                          changed: [], diffText: "", spec: SPEC, specDir: "d" })
    expect(r.status).toBe("NOT_EVALUATED")
  })
  it("I6: Gfull is NOT_EVALUATED on an empty diff — nothing to gate", () => {
    const run = () => ({ code: 0, output: "" })
    const r = gateGfull({ run, policy: POLICY, changed: [], diffText: "", spec: SPEC, specDir: "d" })
    expect(r.status).toBe("NOT_EVALUATED")
    expect(r.reasons.join()).toContain("empty diff")
  })
  it("I6: Gfast is NOT_EVALUATED on an empty diff — nothing to gate", () => {
    const run = () => ({ code: 0, output: "" })
    const r = gateGfast({ run, policy: POLICY, changed: [] })
    expect(r.status).toBe("NOT_EVALUATED")
    expect(r.reasons.join()).toContain("empty diff")
  })
})

// Policy conflated two different states: a command nobody filled in ("we don't know") and a
// command that does not exist ("this project has no build step"). Both read as empty, so any
// plain-JS repo with no bundler and no TypeScript could never reach a green G-fast or G-full.
// `none` is the owner's written declaration of absence, in a meta-class file agents never edit.
describe("commands declared none", () => {
  const runner = () => {
    const ran = []
    return { ran, run: (cmd) => { ran.push(cmd); return { code: 0, output: "" } } }
  }
  const SPEC = { allowedPaths: ["src/**"], requiredTests: [] }

  it("skips a build declared none and still reaches PASS", () => {
    const { ran, run } = runner()
    const r = gateGfull({ run, policy: { commands: { build: "none", test_all: "npm test" } },
                          changed: ["src/a.js"], diffText: "", spec: SPEC, specDir: "docs/specs/f" })
    expect(r.status).toBe("PASS")
    expect(ran).toEqual(["npm test"])
  })

  // A green that ran everything and a green that skipped a step must not look identical.
  it("names every skipped step in the result, so the green is not silent about it", () => {
    const { run } = runner()
    const r = gateGfull({ run, policy: { commands: { build: "none", test_all: "npm test" } },
                          changed: ["src/a.js"], diffText: "", spec: SPEC, specDir: "docs/specs/f" })
    expect(r.skipped).toEqual(["build"])
  })

  it("skips a typecheck declared none in G-fast", () => {
    const { ran, run } = runner()
    const r = gateGfast({ run, policy: { commands: { typecheck: "none", test_related: "npx vitest related --run {files}" } },
                          changed: ["src/a.js"] })
    expect(r.status).toBe("PASS")
    expect(r.skipped).toEqual(["typecheck"])
    expect(ran).toHaveLength(1)
  })

  it("still refuses when a command is merely absent — unknown is not the same as none", () => {
    const { run } = runner()
    const r = gateGfull({ run, policy: { commands: { test_all: "npm test" } },
                          changed: ["src/a.js"], diffText: "", spec: SPEC, specDir: "docs/specs/f" })
    expect(r.status).toBe("NOT_EVALUATED")
    expect(r.reasons.join()).toContain("build")
  })

  it("a step that runs and fails still fails, none or not elsewhere", () => {
    const run = (cmd) => (cmd === "npm test" ? { code: 1, output: "boom" } : { code: 0, output: "" })
    const r = gateGfull({ run, policy: { commands: { build: "none", test_all: "npm test" } },
                          changed: ["src/a.js"], diffText: "", spec: SPEC, specDir: "docs/specs/f" })
    expect(r.status).toBe("FAIL")
  })
})

describe("failure diagnostics (D1): a red gate must show WHY", () => {
  // The bug this fixes: reasons carried `output.slice(-400)` of stdout+stderr concatenated.
  // tsc writes its diagnostics to stdout; node writes a ~350-char ExperimentalWarning to
  // stderr. The tail window was eaten by the warning and the reason printed exactly `'.` —
  // a red gate whose cause is invisible is barely better than a NOT_EVALUATED.
  const NODE_NOISE =
    "(node:74170) ExperimentalWarning: CommonJS module /opt/homebrew/lib/node_modules/npm/node_modules/debug/src/node.js " +
    "is loading ES Module /opt/homebrew/lib/node_modules/npm/node_modules/supports-color/index.js using require().\n" +
    "Support for loading ES Module in require() is an experimental feature and might change at any time\n" +
    "(Use `node --trace-warnings ...` to show where the warning was created)\n"
  const TSC_ERR = "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\n"

  it("keeps stdout diagnostics when stderr noise is longer than the excerpt window", () => {
    const run = (cmd) => cmd === "tsc"
      ? { code: 2, output: TSC_ERR + NODE_NOISE, stdout: TSC_ERR, stderr: NODE_NOISE }
      : { code: 0, output: "", stdout: "", stderr: "" }
    const r = gateGfast({ run, policy: POLICY, changed: ["src/lib/export/a.ts"] })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join("\n")).toContain("TS2322")
  })

  it("falls back to stderr when stdout is empty (jest and friends report there)", () => {
    const run = (cmd) => cmd === "tsc"
      ? { code: 1, output: "FAIL test/a.test.ts\n", stdout: "", stderr: "FAIL test/a.test.ts\n" }
      : { code: 0, output: "", stdout: "", stderr: "" }
    expect(gateGfast({ run, policy: POLICY, changed: ["src/a.ts"] }).reasons.join("\n")).toContain("FAIL test/a.test.ts")
  })

  it("says so rather than printing an empty reason when a command fails silently", () => {
    const run = () => ({ code: 3, output: "", stdout: "", stderr: "" })
    expect(gateGfast({ run, policy: POLICY, changed: ["src/a.ts"] }).reasons.join("\n")).toContain("no output")
  })

  it("excerpt keeps the head as well as the tail of a long diagnostic", () => {
    const many = Array.from({ length: 80 }, (_, i) => `src/f${i}.ts(1,1): error TS100${i}: bad`).join("\n")
    const run = (cmd) => cmd === "tsc"
      ? { code: 2, output: many, stdout: many, stderr: "" }
      : { code: 0, output: "", stdout: "", stderr: "" }
    const joined = gateGfast({ run, policy: POLICY, changed: ["src/a.ts"] }).reasons.join("\n")
    expect(joined).toContain("TS1000")   // first error survives
    expect(joined).toContain("TS10079")  // last error survives
    expect(joined).toMatch(/omitted/)    // and the gap is declared, never silently dropped
  })

  it("a run that predates stdout/stderr still yields its combined output", () => {
    const run = (cmd) => cmd === "tsc" ? { code: 1, output: "legacy TS9999" } : { code: 0, output: "" }
    expect(gateGfast({ run, policy: POLICY, changed: ["src/a.ts"] }).reasons.join("\n")).toContain("TS9999")
  })
})
