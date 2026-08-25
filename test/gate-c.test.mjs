import { describe, it, expect } from "vitest"
import { gateC } from "../src/core/gates.mjs"

describe("gate C", () => {
  const R = (gate, status, digest) => ({ gate, status, digest, at: "t" })
  it("PASSes when every required gate is green for the current digest", () => {
    const results = [R("L", "PASS", "d"), R("R", "PASS", "d"), R("Gfull", "PASS", "d")]
    expect(gateC({ results, requires: ["L", "R", "Gfull"], digest: "d" }).status).toBe("PASS")
  })
  it("FAILs when a gate is green for a STALE digest", () => {
    const results = [R("L", "PASS", "old"), R("R", "PASS", "d"), R("Gfull", "PASS", "d")]
    const r = gateC({ results, requires: ["L", "R", "Gfull"], digest: "d" })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("stale")
  })
  it("the LATEST entry per gate wins — an old PASS cannot mask a new FAIL", () => {
    const results = [R("Gfull", "PASS", "d"), R("Gfull", "FAIL", "d")]
    expect(gateC({ results, requires: ["Gfull"], digest: "d" }).status).toBe("FAIL")
  })
  it("a missing gate is named", () => {
    const r = gateC({ results: [], requires: ["L"], digest: "d" })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("L")
  })
  it("malformed ledger entry lacking digest is handled gracefully", () => {
    const results = [{ gate: "L", status: "PASS", at: "t" }]
    const r = gateC({ results, requires: ["L"], digest: "d" })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("malformed")
  })

  describe("C1 — tree-bound gates bind to the working tree, not only the spec digest", () => {
    const RT = (gate, status, digest, tree) => ({ gate, status, digest, tree, at: "t" })
    it("PASSes when every tree-bound gate is green for the current digest AND tree", () => {
      const results = [RT("Gfast", "PASS", "d", "t1"), RT("Gfull", "PASS", "d", "t1")]
      expect(gateC({ results, requires: ["Gfast", "Gfull"], digest: "d", tree: "t1" }).status).toBe("PASS")
    })
    it("FAILs when a gate is green for a STALE tree, naming the reason", () => {
      const results = [RT("Gfull", "PASS", "d", "OLD-TREE")]
      const r = gateC({ results, requires: ["Gfull"], digest: "d", tree: "t1" })
      expect(r.status).toBe("FAIL")
      expect(r.reasons.join()).toContain("stale tree")
    })
    it("FAILs when a tree-bound ledger entry has no tree recorded at all", () => {
      const results = [RT("Gfull", "PASS", "d", undefined)]
      const r = gateC({ results, requires: ["Gfull"], digest: "d", tree: "t1" })
      expect(r.status).toBe("FAIL")
      expect(r.reasons.join()).toContain("stale tree")
    })
  })

  describe("C5 — L and R are not tree-bound; R binds to the required tests", () => {
    const E = (gate, status, extra) => ({ gate, status, digest: "d", at: "t", ...extra })
    it("L stays green after the tree moves — it inspected the spec, nothing else", () => {
      const results = [E("L", "PASS", { tree: "BEFORE-IMPL" })]
      expect(gateC({ results, requires: ["L"], digest: "d", tree: "AFTER-IMPL" }).status).toBe("PASS")
    })
    it("R stays green after the tree moves, as long as the required tests are untouched", () => {
      const results = [E("R", "PASS", { tree: "BEFORE-IMPL", tests: "x1" })]
      expect(gateC({ results, requires: ["R"], digest: "d", tree: "AFTER-IMPL", tests: "x1" }).status).toBe("PASS")
    })
    it("R FAILs when the required tests changed after RED, naming the reason", () => {
      const results = [E("R", "PASS", { tree: "BEFORE-IMPL", tests: "x1" })]
      const r = gateC({ results, requires: ["R"], digest: "d", tree: "AFTER-IMPL", tests: "WEAKENED" })
      expect(r.status).toBe("FAIL")
      expect(r.reasons.join()).toContain("stale required tests")
    })
    it("R FAILs when its ledger entry predates the tests binding — no binding is never green", () => {
      const results = [E("R", "PASS", { tree: "BEFORE-IMPL" })]
      const r = gateC({ results, requires: ["R"], digest: "d", tree: "t", tests: "x1" })
      expect(r.status).toBe("FAIL")
      expect(r.reasons.join()).toContain("stale required tests")
    })
  })
})

// #4: the gates run their commands against the working tree; git builds the commit from the
// index. A green that inspected content the commit will not contain is not a green.
describe("gate C — index drift", () => {
  const R = (gate, status) => ({ gate, status, digest: "d", at: "t" })
  it("FAILs when the working tree has drifted from the index, naming the files", () => {
    const r = gateC({ results: [R("L", "PASS")], requires: ["L"], digest: "d", drift: ["src/a.ts"] })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("src/a.ts")
  })
  it("PASSes with no drift", () => {
    expect(gateC({ results: [R("L", "PASS")], requires: ["L"], digest: "d", drift: [] }).status).toBe("PASS")
  })
})

// #6: an escalated tier invalidates the lock — the spec was reviewed and locked under lighter
// ceremony than the diff turned out to need.
describe("gate C — blockers", () => {
  it("FAILs on a caller-supplied blocker even when every gate is green", () => {
    const r = gateC({
      results: [{ gate: "L", status: "PASS", digest: "d", at: "t" }],
      requires: ["L"], digest: "d",
      blockers: ["tier escalated B → A by the actual diff — re-lock required"],
    })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("re-lock")
  })
})
