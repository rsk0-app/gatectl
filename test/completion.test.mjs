import { describe, it, expect } from "vitest"
import { decideCompletion } from "../src/core/completion.mjs"

const SPEC = { missingSections: [], blockingQuestions: [], acceptanceCriteriaWithoutTests: [], digest: "spec1", tree: "tree1" }
const OBLIGATIONS = [
  { criterion: "AC-01", file: "test/a.test.ts", selector: "does the thing" },
  { criterion: "AC-02", file: "test/b.test.ts", selector: null },
]
const RED = {
  digest: "spec1", replay: { base: "base1", tree: "redtree" },
  criteria: [
    { criterion: "AC-01", red: { ok: true, classification: "assertion", executed: true } },
    { criterion: "AC-02", red: { ok: true, classification: "assertion", executed: true } },
  ],
}
const GREEN = {
  digest: "spec1", tree: "tree1",
  criteria: [
    { criterion: "AC-01", green: { ok: true, classification: "assertion", executed: true } },
    { criterion: "AC-02", green: { ok: true, classification: "assertion", executed: true } },
  ],
}
const OK = { spec: SPEC, obligations: OBLIGATIONS, red: RED, green: GREEN, gateC: { status: "PASS" }, attestation: { ok: true } }
const names = (r) => r.failed_predicates.map((f) => f.predicate)

describe("completion authority", () => {
  it("ACCEPTs only when every predicate holds", () => {
    expect(decideCompletion(OK)).toMatchObject({ decision: "ACCEPT", failed_predicates: [], basis: "criterion_red_green" })
  })

  // The pair of halves is the whole idea.
  it("REJECTs a criterion with GREEN but no RED — a test that may never have been able to fail", () => {
    const red = { ...RED, criteria: [RED.criteria[0]] }
    const r = decideCompletion({ ...OK, red })
    expect(r.decision).toBe("REJECT")
    expect(r.failed_predicates.find((f) => f.predicate === "red_proven").detail).toContain("AC-02")
  })

  it("REJECTs a criterion with RED but no GREEN — a test nobody made pass", () => {
    const green = { ...GREEN, criteria: [GREEN.criteria[1]] }
    expect(decideCompletion({ ...OK, green }).failed_predicates.find((f) => f.predicate === "green_proven").detail)
      .toContain("AC-01")
  })

  it("REJECTs a RED that was judged on a working tree rather than replayed", () => {
    const { replay, ...noReplay } = RED
    const r = decideCompletion({ ...OK, red: noReplay })
    expect(r.failed_predicates.find((f) => f.predicate === "red_proven").detail).toContain("--base")
  })

  it("REJECTs evidence about another tree or an older spec", () => {
    expect(decideCompletion({ ...OK, green: { ...GREEN, tree: "other" } }).failed_predicates.map((f) => f.detail).join())
      .toContain("different tree")
    expect(decideCompletion({ ...OK, red: { ...RED, digest: "spec0" } }).failed_predicates.map((f) => f.detail).join())
      .toContain("older spec")
  })

  it("REJECTs a criterion whose RED was the wrong kind of failure", () => {
    const red = { ...RED, criteria: [{ criterion: "AC-01", red: { ok: false, classification: "load" } }, RED.criteria[1]] }
    expect(decideCompletion({ ...OK, red }).failed_predicates.map((f) => f.detail).join()).toContain("was never RED (load)")
  })

  it("REJECTs when nothing was promised at all", () => {
    expect(names(decideCompletion({ ...OK, obligations: [] }))).toContain("every_criterion_has_a_test")
  })

  it("REJECTs open blocking questions", () => {
    expect(names(decideCompletion({ ...OK, spec: { ...SPEC, blockingQuestions: ["which clock?"] } })))
      .toContain("no_open_questions")
  })

  it("REJECTs when gate C is not green, or the attestation is not for this tree", () => {
    expect(names(decideCompletion({ ...OK, gateC: { status: "FAIL" } }))).toContain("commit_check_green")
    expect(names(decideCompletion({ ...OK, attestation: { ok: false, detail: "stale" } }))).toContain("attested_for_this_tree")
  })

  it("reports every failed predicate, not the first — one round of asking, not five", () => {
    const r = decideCompletion({
      spec: { missingSections: ["rollback"], blockingQuestions: ["q"], acceptanceCriteriaWithoutTests: ["AC-09"], digest: "spec1", tree: "tree1" },
      obligations: OBLIGATIONS, red: null, green: null, gateC: { status: "FAIL" }, attestation: { ok: false },
    })
    expect(new Set(names(r))).toEqual(new Set([
      "spec_complete", "no_open_questions", "every_criterion_has_a_test",
      "red_proven", "green_proven", "commit_check_green", "attested_for_this_tree",
    ]))
  })
})
