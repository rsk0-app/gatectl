import { describe, it, expect } from "vitest"
import { gateL } from "../src/core/gates.mjs"

const POLICY = { critic: { required_for_tiers: ["A", "B"] } }
const MVP = { mvp_done_when: [{ id: "operator-can-export", text: "..." }], out_of_scope: [] }
const SPEC = {
  state: "DRAFT", mvpRef: "operator-can-export", intent: "x",
  invariants: ["I1"], acceptanceCriteria: ["AC1 — required: test/a.test.ts"],
  requiredTests: ["test/a.test.ts"], acceptanceCriteriaWithoutTests: [],
  allowedPaths: ["src/**"], rollback: "flag", blockingQuestions: [], missingSections: [],
}
const CRITIQUE = { provider: "openai", model: "m", findings: [{ severity: "high", resolved: true }] }

describe("gate L", () => {
  it("passes a complete spec with a resolved critique", () => {
    expect(gateL({ spec: SPEC, critique: CRITIQUE, tier: "B", policy: POLICY, mvp: MVP }).status).toBe("PASS")
  })
  it("FAILs on missing sections, naming them", () => {
    const r = gateL({ spec: { ...SPEC, missingSections: ["rollback"] }, critique: CRITIQUE, tier: "B", policy: POLICY, mvp: MVP })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("rollback")
  })
  it("FAILs on open BLOCKING questions", () => {
    expect(gateL({ spec: { ...SPEC, blockingQuestions: ["?"] }, critique: CRITIQUE, tier: "B", policy: POLICY, mvp: MVP }).status).toBe("FAIL")
  })
  it("FAILs when mvp_ref names nothing in MVP.yaml", () => {
    expect(gateL({ spec: { ...SPEC, mvpRef: "ghost" }, critique: CRITIQUE, tier: "B", policy: POLICY, mvp: MVP }).status).toBe("FAIL")
  })
  it("maintenance is a legal mvp_ref", () => {
    expect(gateL({ spec: { ...SPEC, mvpRef: "maintenance" }, critique: CRITIQUE, tier: "B", policy: POLICY, mvp: MVP }).status).toBe("PASS")
  })
  it("FAILs when an AC names no test", () => {
    expect(gateL({ spec: { ...SPEC, acceptanceCriteriaWithoutTests: ["AC9"] }, critique: CRITIQUE, tier: "B", policy: POLICY, mvp: MVP }).status).toBe("FAIL")
  })
  it("NOT_EVALUATED when critique is absent or empty for tiers that require it", () => {
    expect(gateL({ spec: SPEC, critique: null, tier: "A", policy: POLICY, mvp: MVP }).status).toBe("NOT_EVALUATED")
    expect(gateL({ spec: SPEC, critique: { findings: [] }, tier: "B", policy: POLICY, mvp: MVP }).status).toBe("NOT_EVALUATED")
  })
  it("tier C needs no critique", () => {
    expect(gateL({ spec: SPEC, critique: null, tier: "C", policy: POLICY, mvp: MVP }).status).toBe("PASS")
  })
  it("FAILs on unresolved critical/high", () => {
    const c = { findings: [{ severity: "high", resolved: false }] }
    expect(gateL({ spec: SPEC, critique: c, tier: "B", policy: POLICY, mvp: MVP }).status).toBe("FAIL")
  })
  it("a deterministic FAIL wins over an absent critique", () => {
    const r = gateL({ spec: { ...SPEC, missingSections: ["rollback"] }, critique: null, tier: "A", policy: POLICY, mvp: MVP })
    expect(r.status).toBe("FAIL")
  })
  it("I5: an absent critic policy block fails closed — critique required for EVERY tier, including C", () => {
    const r = gateL({ spec: SPEC, critique: null, tier: "C", policy: {}, mvp: MVP })
    expect(r.status).toBe("NOT_EVALUATED")
  })
  it("I5: an absent critic policy block still lets a deterministic spec FAIL win", () => {
    const r = gateL({ spec: { ...SPEC, missingSections: ["rollback"] }, critique: null, tier: "C", policy: {}, mvp: MVP })
    expect(r.status).toBe("FAIL")
  })
  it("I5: an explicit empty required_for_tiers still FAILs on an unresolved severe finding in a provided critique", () => {
    const notRequired = { critic: { required_for_tiers: [] } }
    const c = { findings: [{ severity: "high", resolved: false }] }
    const r = gateL({ spec: SPEC, critique: c, tier: "B", policy: notRequired, mvp: MVP })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("unresolved critical/high")
  })
})
