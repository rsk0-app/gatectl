import { describe, it, expect } from "vitest"
import { parseCritique } from "../src/core/critique.mjs"

const HEADER = "# Critique — X\n\n- provider: openai\n- model: gpt-5.1-codex-mini\n\n---"

describe("explicit SEVERITY lines", () => {
  it("parses severity and per-block resolution", () => {
    const text = [HEADER,
      "## 1. inner join drops the base", "SEVERITY: critical", "Body.", "RESOLVED: left join.",
      "", "## 2. no as-of bound", "SEVERITY: high", "Open."].join("\n")
    expect(parseCritique(text).findings).toEqual([
      expect.objectContaining({ severity: "critical", resolved: true }),
      expect.objectContaining({ severity: "high", resolved: false }),
    ])
  })
})

describe("severity in the heading (gpt-5.6-sol shape)", () => {
  it("reads plain and bold heading tokens", () => {
    const text = [HEADER,
      "## 1. HIGH — D-4 contradicts D-2", "Body.",
      "", "## 2. **CRITICAL — artifact check**", "Body.", "**RESOLVED: deferred with evidence.**",
      "", "## 3. MEDIUM — substrings", "Body.",
      "", "## 4. LOW — cost profile", "Body."].join("\n")
    const f = parseCritique(text).findings
    expect(f.map((x) => x.severity)).toEqual(["high", "critical", "medium", "low"])
    expect(f[1].resolved).toBe(true)
  })
  it("prose mentioning a severity word invents nothing", () => {
    const text = [HEADER,
      "## 1. Summary", "This is critical reading and a high-level overview.",
      "", "## 2. HIGH — real", "Body."].join("\n")
    expect(parseCritique(text).findings.map((x) => x.severity)).toEqual(["high"])
  })
  it("RESOLVED closes only its own block", () => {
    const text = [HEADER,
      "## 1. HIGH — first", "RESOLVED: fixed.",
      "", "## 2. HIGH — second", "Open."].join("\n")
    expect(parseCritique(text).findings.map((x) => x.resolved)).toEqual([true, false])
  })
})

describe("T-004 regression corpus — the shape that parsed as zero", () => {
  it("verbatim headings yield findings", () => {
    const text = [HEADER,
      "## 1. HIGH — D-4 contradicts D-2 and does not provide retry determinism", "Body.",
      "", "## 6. HIGH — `targetExists` and `targetExistence` are contradictory result contracts", "Body.",
      "", "## 14. LOW — The one-founder cost profile makes AC8 the first likely bypass", "Body."].join("\n")
    expect(parseCritique(text).findings).toHaveLength(3)
  })
})

describe("C3 — hyphenated words in a heading must not invent findings", () => {
  it("'low-hanging' does not read as severity low", () => {
    const text = [HEADER,
      "## 1. Summary of low-hanging concerns", "No findings."].join("\n")
    expect(parseCritique(text).findings).toHaveLength(0)
  })
  it("'high-level' does not read as severity high", () => {
    const text = [HEADER,
      "## 2. Notes on the high-level architecture", "No findings."].join("\n")
    expect(parseCritique(text).findings).toHaveLength(0)
  })
})
