import { describe, it, expect } from "vitest"
import { nextStep } from "../src/core/next.mjs"

const SPEC = { blockingQuestions: [] }
const F = { slug: "f1" }
const CRIT = { findings: [{ severity: "high", resolved: true }] }
const entry = (gate, extra = {}) => ({ gate, status: "PASS", digest: "d1", tree: "t1", ...extra })
const BASE = {
  feature: F, spec: SPEC, digest: "d1", tree: "t1", tests: "x1", critique: CRIT,
  requires: ["L", "R", "Gfull"], hasImplementation: true, attested: true, baseHint: "abc1234",
}
const withResults = (...results) => ({ ...BASE, results })
const RED = entry("R", { tests: "x1", replay: { base: "abc1234" } })

describe("nextStep", () => {
  it("no feature at all", () => {
    expect(nextStep({ ...BASE, feature: null })).toMatchObject({ state: "NO_FEATURE", next_command: "gatectl new <slug>" })
  })

  it("a spec that does not compile names the errors and asks for an edit, not a gate", () => {
    const r = nextStep({ ...BASE, feature: { slug: "f1", compileErrors: ["AC-01 names no test"] } })
    expect(r).toMatchObject({ state: "SPEC_INVALID" })
    expect(r.errors).toEqual(["AC-01 names no test"])
  })

  it("an open blocking question stops everything and offers no command", () => {
    const r = nextStep({ ...BASE, spec: { blockingQuestions: ["which clock?"] } })
    expect(r).toMatchObject({ state: "BLOCKED", next_command: null })
    expect(r.allowed_actions).toEqual(["answer_blocking_questions"])
  })

  it("no critique yet", () => {
    expect(nextStep({ ...BASE, critique: null })).toMatchObject({ state: "SPEC_REVIEW", next_command: "gatectl critique" })
  })

  it("unresolved severe findings ask for resolutions, not for another critique", () => {
    const critique = { findings: [{ severity: "critical", resolved: false }] }
    expect(nextStep({ ...BASE, critique })).toMatchObject({ state: "SPEC_REVIEW", allowed_actions: ["resolve_findings"] })
  })

  it("resolved critique but no lock", () => {
    expect(nextStep(withResults())).toMatchObject({ state: "SPEC_REVIEW", next_command: "gatectl lock" })
  })

  it("locked but no RED — and the base commit is offered in the command", () => {
    expect(nextStep(withResults(entry("L")))).toMatchObject({ state: "LOCKED", next_command: "gatectl red --base abc1234" })
  })

  it("a RED that was not replayed is not RED enough", () => {
    const r = nextStep(withResults(entry("L"), entry("R", { tests: "x1" })))
    expect(r).toMatchObject({ state: "LOCKED" })
    expect(r.why).toContain("replay")
  })

  it("RED proven, nothing implemented", () => {
    expect(nextStep({ ...withResults(entry("L"), RED), hasImplementation: false }))
      .toMatchObject({ state: "RED_PROVEN", allowed_actions: ["implement"] })
  })

  it("implemented but no GREEN evidence", () => {
    expect(nextStep(withResults(entry("L"), RED))).toMatchObject({ state: "IMPLEMENTING", next_command: "gatectl green" })
  })

  it("GREEN but the full gate has not run over this tree", () => {
    expect(nextStep(withResults(entry("L"), RED, entry("Green")))).toMatchObject({ state: "GREEN", next_command: "gatectl gate full" })
  })

  it("tier A asks for the cross-model review, and only tier A", () => {
    const results = [entry("L"), RED, entry("Green"), entry("Gfull")]
    expect(nextStep({ ...withResults(...results), requires: ["L", "R", "Gfull", "X"] }))
      .toMatchObject({ state: "GREEN", next_command: "gatectl review" })
    expect(nextStep({ ...withResults(...results), attested: false })).toMatchObject({ state: "REVIEWED", next_command: "gatectl commit-check" })
  })

  it("green everywhere but not yet attested asks for commit-check", () => {
    const results = [entry("L"), RED, entry("Green"), entry("Gfull")]
    expect(nextStep({ ...withResults(...results), attested: false }))
      .toMatchObject({ state: "REVIEWED", next_command: "gatectl commit-check" })
  })

  it("everything bound, waiting on the authority", () => {
    const results = [entry("L"), RED, entry("Green"), entry("Gfull"), entry("Complete")]
    expect(nextStep({ ...withResults(...results), completion: "REJECT" }))
      .toMatchObject({ state: "VERIFIED", next_command: "gatectl complete" })
  })

  it("COMPLETED offers nothing further", () => {
    const results = [entry("L"), RED, entry("Green"), entry("Gfull"), entry("Complete")]
    const r = nextStep({ ...withResults(...results), completion: "ACCEPT" })
    expect(r).toMatchObject({ state: "COMPLETED", next_command: null })
    expect(r.allowed_actions).toEqual([])
  })

  // The rule that makes the machine worth anything: state is derived, so moving the tree moves
  // the state back on its own.
  it("editing the tree after GREEN drops the state back to IMPLEMENTING", () => {
    const results = [entry("L"), RED, entry("Green"), entry("Gfull")]
    expect(nextStep({ ...withResults(...results), tree: "t2" })).toMatchObject({ state: "IMPLEMENTING", next_command: "gatectl green" })
  })

  it("editing a required test after RED drops the state back to LOCKED", () => {
    const results = [entry("L"), RED, entry("Green"), entry("Gfull")]
    expect(nextStep({ ...withResults(...results), tests: "WEAKENED" })).toMatchObject({ state: "LOCKED" })
  })

  it("editing the spec drops everything back to the lock", () => {
    const results = [entry("L"), RED, entry("Green"), entry("Gfull")]
    expect(nextStep({ ...withResults(...results), digest: "d2" })).toMatchObject({ next_command: "gatectl lock" })
  })
})
