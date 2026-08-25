import { describe, it, expect } from "vitest"
import { testPatch, implementationPatch, judgeRed, judgeGreen } from "../src/core/replay.mjs"
import { matchesAny } from "../src/core/tier.mjs"

const matches = (p, globs) => matchesAny(p, globs)
const CHANGED = ["src/auth/refresh.ts", "test/auth.test.ts", "test/helpers/clock.ts", "docs/notes.md"]
const GLOBS = ["test/**"]

describe("splitting a diff into its test half", () => {
  it("takes everything under the declared test paths", () => {
    expect(testPatch({ changed: CHANGED, testGlobs: GLOBS, matches }))
      .toEqual(["test/auth.test.ts", "test/helpers/clock.ts"])
  })

  it("takes a file a criterion names even when it lies outside those paths", () => {
    expect(testPatch({ changed: CHANGED, obligationFiles: ["src/auth/refresh.ts"], testGlobs: GLOBS, matches }))
      .toContain("src/auth/refresh.ts")
  })

  it("the implementation half is exactly what is left", () => {
    expect(implementationPatch({ changed: CHANGED, testGlobs: GLOBS, matches }))
      .toEqual(["src/auth/refresh.ts", "docs/notes.md"])
  })

  it("a diff that is only tests leaves nothing to implement", () => {
    expect(implementationPatch({ changed: ["test/a.test.ts"], testGlobs: GLOBS, matches })).toEqual([])
  })
})

const OB = { criterion: "AC-01", file: "test/auth.test.ts", selector: "rejects an expired token", expected_red: "assertion" }
const classify = (out) => (out.includes("AssertionError") ? "assertion" : out.includes("Cannot find") ? "load" : out.includes("No test") ? "empty" : "unknown")

describe("judging one criterion's RED", () => {
  it("PASSes on the failure kind the criterion declared", () => {
    expect(judgeRed({ obligation: OB, result: { code: 1, output: "AssertionError: x" }, classify }))
      .toMatchObject({ ok: true, status: "PASS", kind: "assertion" })
  })

  it("REFUSES a different kind of failure — a broken harness is not a red test", () => {
    const r = judgeRed({ obligation: OB, result: { code: 1, output: "Cannot find module './x'" }, classify })
    expect(r).toMatchObject({ ok: false, status: "NOT_EVALUATED", kind: "load" })
    expect(r.reason).toContain('declares its RED as "assertion"')
  })

  it("honours a criterion that declares a load-shaped RED", () => {
    const ob = { ...OB, expected_red: "load" }
    expect(judgeRed({ obligation: ob, result: { code: 1, output: "Cannot find module './x'" }, classify }).ok).toBe(true)
  })

  it("FAILs when the test already passes at the base — there is nothing to implement", () => {
    const r = judgeRed({ obligation: OB, result: { code: 0, output: "1 passed" }, classify })
    expect(r).toMatchObject({ ok: false, status: "FAIL" })
    expect(r.reason).toContain("already passes at the base commit")
  })

  it("REFUSES a run that matched nothing, whatever it exited with", () => {
    expect(judgeRed({ obligation: OB, result: { code: 0, output: "No test matched" }, classify }).status).toBe("NOT_EVALUATED")
    expect(judgeRed({ obligation: OB, result: { code: 1, output: "No test matched" }, classify }).status).toBe("NOT_EVALUATED")
  })

  it("names the criterion and the case, not just the file", () => {
    const r = judgeRed({ obligation: OB, result: { code: 0, output: "ok" }, classify })
    expect(r.reason).toContain('AC-01 (test/auth.test.ts::"rejects an expired token")')
  })
})

describe("judging the same criterion's GREEN", () => {
  it("PASSes on exit 0 with tests actually run", () => {
    expect(judgeGreen({ obligation: OB, result: { code: 0, output: "1 passed" }, classify }).ok).toBe(true)
  })

  it("FAILs when it still does not pass", () => {
    const r = judgeGreen({ obligation: OB, result: { code: 1, output: "AssertionError: x" }, classify })
    expect(r).toMatchObject({ ok: false, status: "FAIL" })
    expect(r.reason).toContain("does not pass on the final tree")
  })

  it("REFUSES exit 0 from a run that executed nothing", () => {
    expect(judgeGreen({ obligation: OB, result: { code: 0, output: "No test matched" }, classify }).status)
      .toBe("NOT_EVALUATED")
  })
})
