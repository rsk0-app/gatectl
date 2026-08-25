import { describe, it, expect } from "vitest"
import { validateSpec, compileSpec, obligations } from "../src/core/spec-compile.mjs"

const SPEC = {
  id: "session-auth",
  state: "DRAFT",
  mvp_ref: "works",
  intent: "Refresh tokens expire.",
  invariants: [{ id: "INV-01", statement: "Existing sessions remain valid" }],
  acceptance_criteria: [
    { id: "AC-01", statement: "An expired refresh token is rejected",
      test: { file: "test/auth.test.ts", selector: "rejects an expired refresh token" } },
    { id: "AC-02", statement: "A valid refresh token is accepted",
      test: { file: "test/auth.test.ts", selector: "accepts a valid refresh token" } },
  ],
  allowed_paths: ["src/auth/**", "test/auth/**"],
  rollback: { strategy: "feature-flag" },
}
const without = (key) => { const { [key]: _, ...rest } = SPEC; return rest }

describe("validateSpec", () => {
  it("accepts a complete spec", () => {
    expect(validateSpec(SPEC)).toEqual({ ok: true, errors: [] })
  })

  it("names every missing field at once, not the first", () => {
    const r = validateSpec({ id: "x" })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain("missing: intent")
    expect(r.errors.join()).toContain("missing: acceptance_criteria")
  })

  // The rule the whole file exists for.
  it("REFUSES a criterion with no test — a promise nothing proves is not a criterion", () => {
    const r = validateSpec({ ...SPEC, acceptance_criteria: [{ id: "AC-01", statement: "it works" }] })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain("names no test")
  })

  it("REFUSES two criteria pointing at the same case — one of them is not really covered", () => {
    const dup = [SPEC.acceptance_criteria[0], { ...SPEC.acceptance_criteria[1], test: SPEC.acceptance_criteria[0].test }]
    const r = validateSpec({ ...SPEC, acceptance_criteria: dup })
    expect(r.errors.join()).toContain("name the same test case")
  })

  it("REFUSES duplicate identifiers — evidence about AC-01 must mean one thing", () => {
    const dup = [SPEC.acceptance_criteria[0], { ...SPEC.acceptance_criteria[1], id: "AC-01" }]
    expect(validateSpec({ ...SPEC, acceptance_criteria: dup }).errors.join()).toContain("duplicate id: AC-01")
  })

  it("REFUSES an id that is not of the stable form", () => {
    const bad = [{ ...SPEC.acceptance_criteria[0], id: "first one" }]
    expect(validateSpec({ ...SPEC, acceptance_criteria: bad }).errors.join()).toContain("is not of the form AC-01")
  })

  it("REFUSES an empty criteria list and an empty allowed_paths", () => {
    expect(validateSpec({ ...SPEC, acceptance_criteria: [] }).errors.join()).toContain("cannot be delivered")
    expect(validateSpec({ ...SPEC, allowed_paths: [] }).errors.join()).toContain("has no scope")
  })

  it("REFUSES an unknown state rather than treating it as DRAFT", () => {
    expect(validateSpec({ ...SPEC, state: "PROBABLY_FINE" }).errors.join()).toContain("state must be one of")
  })

  it("REFUSES a rollback with no strategy", () => {
    expect(validateSpec({ ...SPEC, rollback: {} }).errors.join()).toContain("rollback.strategy")
  })

  it("requires a selector to be a real string when present, but allows its absence", () => {
    const noSel = [{ ...SPEC.acceptance_criteria[0], test: { file: "test/a.test.ts" } }]
    expect(validateSpec({ ...SPEC, acceptance_criteria: noSel, }).ok).toBe(true)
    const empty = [{ ...SPEC.acceptance_criteria[0], test: { file: "test/a.test.ts", selector: "" } }]
    expect(validateSpec({ ...SPEC, acceptance_criteria: empty }).errors.join()).toContain("selector must be")
  })
})

describe("obligations manifest", () => {
  it("carries one entry per criterion, with the case it is proven by", () => {
    expect(obligations(SPEC)).toEqual([
      { criterion: "AC-01", statement: "An expired refresh token is rejected", file: "test/auth.test.ts",
        selector: "rejects an expired refresh token", expected_red: "assertion" },
      { criterion: "AC-02", statement: "A valid refresh token is accepted", file: "test/auth.test.ts",
        selector: "accepts a valid refresh token", expected_red: "assertion" },
    ])
  })

  it("honours a criterion that declares a different kind of RED", () => {
    const spec = { ...SPEC, acceptance_criteria: [{ ...SPEC.acceptance_criteria[0],
      test: { ...SPEC.acceptance_criteria[0].test, expected_red: "load" } }] }
    expect(obligations(spec)[0].expected_red).toBe("load")
  })
})

describe("compileSpec", () => {
  it("produces a digest that ignores formatting and key order", () => {
    const a = compileSpec(SPEC)
    const reordered = { ...SPEC, intent: "Refresh tokens expire.\n\n", allowed_paths: [...SPEC.allowed_paths] }
    const b = compileSpec(reordered)
    expect(a.digest).toBe(b.digest)
  })

  it("but changes when a statement changes — the digest identifies the promise", () => {
    const changed = { ...SPEC, acceptance_criteria: [{ ...SPEC.acceptance_criteria[0], statement: "something else" }, SPEC.acceptance_criteria[1]] }
    expect(compileSpec(changed).digest).not.toBe(compileSpec(SPEC).digest)
  })

  it("refuses to compile an invalid spec rather than compiling half of it", () => {
    const r = compileSpec(without("rollback"))
    expect(r.ok).toBe(false)
    expect(r.compiled).toBeUndefined()
  })

  it("normalises absent optional fields so two equivalent specs digest alike", () => {
    const withNulls = { ...SPEC, rollback: { strategy: "feature-flag", notes: null } }
    expect(compileSpec(withNulls).digest).toBe(compileSpec(SPEC).digest)
  })
})
