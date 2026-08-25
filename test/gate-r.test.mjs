import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"
import { classifyFailure, gateR } from "../src/core/gates.mjs"

const POLICY = { failure_classes: {
  assertion: ["^\\s*AssertionError", "^\\s*\\w*Error: expected .* to "],
  load: ["Cannot find module", "SyntaxError", "Failed to load", "ReferenceError"],
} }

describe("classifyFailure", () => {
  it("assertion output classifies as assertion", () => {
    expect(classifyFailure("AssertionError: expected 1 to be 2", POLICY)).toBe("assertion")
  })
  it("module-load output classifies as load", () => {
    expect(classifyFailure("Error: Cannot find module './x'", POLICY)).toBe("load")
  })
  it("crash text mentioning 'expected ... to ...' in prose is NOT an assertion", () => {
    const out = "TypeError: cannot read properties of undefined\nnote: this API is expected to be removed, use bar() to migrate"
    expect(classifyFailure(out, POLICY)).toBe("unknown")
  })
  it("a real vitest assertion still classifies", () => {
    expect(classifyFailure("AssertionError: expected 1 to be 2", POLICY)).toBe("assertion")
  })
})

describe("gate R", () => {
  const ob = (file, selector = null) => ({ ac: "AC1", file, selector })
  const runs = (map) => (o) => map[o.file]

  it("PASSes when every required test fails on an assertion", () => {
    const r = gateR({ obligations: [ob("t/a.test.ts")], run: runs({ "t/a.test.ts": { code: 1, output: "AssertionError: expected" } }) }, POLICY)
    expect(r.status).toBe("PASS")
  })
  it("FAILs when a required test already passes", () => {
    const r = gateR({ obligations: [ob("t/a.test.ts")], run: runs({ "t/a.test.ts": { code: 0, output: "1 passed" } }) }, POLICY)
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("already passes")
  })
  it("NOT_EVALUATED on a load error — a broken file is not RED", () => {
    const r = gateR({ obligations: [ob("t/a.test.ts")], run: runs({ "t/a.test.ts": { code: 1, output: "SyntaxError: x" } }) }, POLICY)
    expect(r.status).toBe("NOT_EVALUATED")
  })
  it("no required tests at all is NOT_EVALUATED, never PASS", () => {
    expect(gateR({ obligations: [], run: runs({}) }, POLICY).status).toBe("NOT_EVALUATED")
  })
  it("an already-passing test FAILs even when another test has a load error", () => {
    const r = gateR({ obligations: [ob("a"), ob("b")],
                      run: (o) => o.file === "a" ? { code: 0, output: "1 passed" } : { code: 1, output: "SyntaxError: x" } }, POLICY)
    expect(r.status).toBe("FAIL")
  })

  // #5 — the case, not just the file.
  describe("test obligations", () => {
    const WITH_EMPTY = { failure_classes: { ...POLICY.failure_classes, empty: ["^\\s*Test Files\\s+\\d+ skipped"] } }

    it("runs a named case through test_case and PASSes on a real assertion", () => {
      const seen = []
      const r = gateR({
        obligations: [ob("t/a.test.ts", "rejects an expired token")],
        caseCommand: true,
        run: (o) => { seen.push(o.selector); return { code: 1, output: "AssertionError: expected" } },
      }, POLICY)
      expect(r.status).toBe("PASS")
      expect(seen).toEqual(["rejects an expired token"])
    })

    it("REFUSES a named case when policy has no test_case command, instead of running the whole file", () => {
      let ran = false
      const r = gateR({ obligations: [ob("t/a.test.ts", "x")], caseCommand: false, run: () => { ran = true; return { code: 1, output: "AssertionError" } } }, POLICY)
      expect(r.status).toBe("NOT_EVALUATED")
      expect(ran).toBe(false)
      expect(r.reasons.join()).toContain("test_case")
    })

    // The trap this exists for: `vitest run file -t "no such test"` exits 0 having run nothing.
    it("NOT_EVALUATED when the runner matched no test, even though it exited 0", () => {
      const r = gateR({
        obligations: [ob("t/a.test.ts", "no such case")], caseCommand: true,
        run: () => ({ code: 0, output: " Test Files  1 skipped (1)\n      Tests  18 skipped (18)" }),
      }, WITH_EMPTY)
      expect(r.status).toBe("NOT_EVALUATED")
      expect(r.reasons.join()).toContain("never ran")
    })

    it("NOT_EVALUATED when the runner matched no test and exited NON-zero too", () => {
      const r = gateR({
        obligations: [ob("t/a.test.ts", "no such case")], caseCommand: true,
        run: () => ({ code: 1, output: " Test Files  0 skipped (0)\nNo test files found" }),
      }, { failure_classes: { ...WITH_EMPTY.failure_classes, empty: ["No test files found"] } })
      expect(r.status).toBe("NOT_EVALUATED")
    })

    it("an exit-0 selector IS just a passing case when the policy can recognise emptiness", () => {
      const r = gateR({
        obligations: [ob("t/a.test.ts", "x")], caseCommand: true,
        run: () => ({ code: 0, output: " Test Files  1 passed (1)\n      Tests  1 passed | 3 skipped" }),
      }, WITH_EMPTY)
      expect(r.status).toBe("FAIL")
      expect(r.reasons.join()).toContain("already passes")
      expect(r.reasons.join()).not.toContain("cannot tell")
    })

    it("an exit-0 selector with no empty pattern configured is FAIL and says the answer is ambiguous", () => {
      const r = gateR({
        obligations: [ob("t/a.test.ts", "x")], caseCommand: true,
        run: () => ({ code: 0, output: "nothing recognisable" }),
      }, POLICY)
      expect(r.status).toBe("FAIL")
      expect(r.reasons.join()).toContain("cannot tell")
    })

    it("two cases in one file are two runs — two criteria are two claims", () => {
      const seen = []
      const r = gateR({
        obligations: [ob("t/a.test.ts", "one"), ob("t/a.test.ts", "two")], caseCommand: true,
        run: (o) => { seen.push(o.selector); return { code: 1, output: "AssertionError: expected" } },
      }, POLICY)
      expect(r.status).toBe("PASS")
      expect(seen).toEqual(["one", "two"])
      expect(r.perTest).toHaveLength(2)
    })

    it("reports the case in its reasons, not just the file", () => {
      const r = gateR({
        obligations: [ob("t/a.test.ts", "rejects expired")], caseCommand: true,
        run: () => ({ code: 1, output: "Cannot find module './x'" }),
      }, POLICY)
      expect(r.reasons.join()).toContain('t/a.test.ts::"rejects expired"')
    })
  })
})

// The shipped policy template is the default every target inherits; its failure_classes decide
// whether a real RED is recognised as RED. The canonical first RED of TDD — the function under
// test does not exist yet — must not land in "unknown" and refuse to be evaluated.
describe("shipped template — failure_classes cover the canonical first RED", () => {
  const shipped = yaml.load(fs.readFileSync(path.resolve("templates/policy.yaml"), "utf8"))

  it("classifies a vitest missing-function failure as an assertion, not unknown", () => {
    const vitestOutput = [
      " FAIL  test/ledger-helper.test.mjs > latestFor > returns the last entry",
      "TypeError: latestFor is not a function",
      "      10|     expect(latestFor(entries, 'Gfull').status).toBe('FAIL')",
    ].join("\n")
    expect(classifyFailure(vitestOutput, shipped)).toBe("assertion")
  })

  it("still classifies a genuinely broken test file as load, never as RED", () => {
    const brokenOutput = "Error: Failed to load url ../src/core/nope.mjs\nCannot find module './nope.mjs'"
    expect(classifyFailure(brokenOutput, shipped)).toBe("load")
  })

  it("still classifies an ordinary assertion failure as an assertion", () => {
    expect(classifyFailure("AssertionError: expected 1 to be 2", shipped)).toBe("assertion")
  })
})

// Recorded from a real run, not imagined: `npx vitest run test/tier.test.mjs -t "no-such-name"`
// prints exactly this and exits 0. If the shipped template did not recognise it, gate R would
// report "already passes" for a case that never executed once.
describe("shipped template — a run that matched nothing is recognised", () => {
  const shipped = yaml.load(fs.readFileSync(path.resolve("templates/policy.yaml"), "utf8"))
  const REAL_NO_MATCH = [
    " RUN  v4.1.10 /Users/x/repo",
    "",
    " Test Files  1 skipped (1)",
    "      Tests  18 skipped (18)",
    "   Start at  12:14:50",
  ].join("\n")

  it("classifies a filtered vitest run that matched nothing as empty", () => {
    expect(classifyFailure(REAL_NO_MATCH, shipped)).toBe("empty")
  })

  it("a filtered run where the named case DID fail is still an assertion", () => {
    const red = [
      " FAIL  test/auth.test.ts > rejects an expired refresh token",
      "AssertionError: expected undefined to be 401",
      " Test Files  1 failed (1)",
      "      Tests  1 failed | 17 skipped (18)",
    ].join("\n")
    expect(classifyFailure(red, shipped)).toBe("assertion")
  })

  it("gate R answers NOT_EVALUATED — not PASS, not FAIL — on that real output", () => {
    const r = gateR({
      obligations: [{ ac: "AC1", file: "test/auth.test.ts", selector: "no such case" }],
      caseCommand: true, run: () => ({ code: 0, output: REAL_NO_MATCH }),
    }, shipped)
    expect(r.status).toBe("NOT_EVALUATED")
  })
})
