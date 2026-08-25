import { describe, it, expect } from "vitest"
import { pageRef, renderPage } from "../src/core/memory-page.mjs"

const SPEC = {
  state: "LOCKED", mvpRef: "operator-can-export", intent: "Let an operator export the ledger.",
  invariants: ["never overwrites an existing page", "no gate reads memory"],
  acceptanceCriteria: ["exports a page — required: test/export.test.ts"],
  requiredTests: ["test/export.test.ts"], acceptanceCriteriaWithoutTests: [],
  allowedPaths: ["src/**", "test/**"], rollback: "delete the adapter", blockingQuestions: [],
  missingSections: [],
}

const RESULTS = [
  { gate: "L", status: "FAIL", digest: "old", at: "2026-08-19T09:00:00.000Z" },
  { gate: "L", status: "PASS", digest: "abc123def456", at: "2026-08-19T10:00:00.000Z" },
  { gate: "R", status: "PASS", digest: "abc123def456", at: "2026-08-19T10:05:00.000Z" },
  { gate: "Gfull", status: "PASS", digest: "abc123def456", at: "2026-08-19T11:00:00.000Z" },
]

const CRITIQUE = {
  provider: "openai", model: "m",
  findings: [
    { severity: "critical", resolved: true, title: "1. unbounded retry" },
    { severity: "high", resolved: false, title: "2. secret in policy file" },
  ],
}

const ARGS = { slug: "memory-export", tier: "B", spec: SPEC, digest: "abc123def456789",
               results: RESULTS, critique: CRITIQUE, at: "2026-08-19T12:00:00.000Z" }

describe("pageRef", () => {
  it("is stable for a slug, so re-exporting overwrites rather than accumulates", () => {
    expect(pageRef("memory-export")).toBe("gatectl/memory-export.md")
    expect(pageRef("memory-export")).toBe(pageRef("memory-export"))
  })
})

describe("renderPage", () => {
  it("renders the delivery record a later agent actually needs", () => {
    const page = renderPage(ARGS)
    expect(page).toContain("# memory-export")
    expect(page).toContain("tier: B")
    expect(page).toContain("state: LOCKED")
    expect(page).toContain("abc123def456")
    expect(page).toContain("Let an operator export the ledger.")
    expect(page).toContain("no gate reads memory")
    expect(page).toContain("required: test/export.test.ts")
    expect(page).toContain("src/**")
    expect(page).toContain("delete the adapter")
  })

  it("renders only the latest ledger entry per gate — the rule gate C applies", () => {
    const page = renderPage(ARGS)
    const lTable = page.split("\n").filter((l) => l.startsWith("| L "))
    expect(lTable).toHaveLength(1)
    expect(lTable[0]).toContain("PASS")
    expect(lTable[0]).toContain("10:00:00")
  })

  it("carries each finding's severity and whether it was resolved", () => {
    const page = renderPage(ARGS)
    expect(page).toContain("critical")
    expect(page).toContain("RESOLVED")
    expect(page).toContain("UNRESOLVED")
  })

  it("is deterministic — same input, byte-identical output", () => {
    expect(renderPage(ARGS)).toBe(renderPage(ARGS))
  })

  it("renders a feature with no critique and no gate results without throwing", () => {
    const page = renderPage({ ...ARGS, critique: null, results: [] })
    expect(page).toContain("# memory-export")
    expect(page).toContain("no gate results")
    expect(page).toContain("no critique")
  })
})

// Recall cannot lean on the service's own search: /wiki/search and /wiki/page/ls both answer
// empty for any wiki that is not `ready`, and `ready` arrives only after an LLM ingest run.
// /wiki/page/read has no such gate, so rda keeps its own index page and reads by ref — which
// also keeps recall a deterministic function of text rda wrote, matching how gates already work.
import { INDEX_REF, renderIndex, parseIndex, rankEntries, mergeEntry } from "../src/core/memory-page.mjs"

const ENTRIES = [
  { slug: "session-auth", tier: "A", intent: "Add session authentication with rotating tokens." },
  { slug: "rate-limit", tier: "B", intent: "Add per-tenant rate limiting to the public API." },
]

describe("index page", () => {
  it("is a ref the service accepts — 'index' is forbidden only at the wiki root", () => {
    expect(INDEX_REF).toBe("gatectl/_index.md")
  })

  it("round-trips through render and parse, in the sorted order render imposes", () => {
    const bySlug = [...ENTRIES].sort((a, b) => (a.slug < b.slug ? -1 : 1))
    expect(parseIndex(renderIndex(ENTRIES))).toEqual(bySlug)
  })

  it("parses an absent or empty index as no entries", () => {
    expect(parseIndex("")).toEqual([])
    expect(parseIndex(null)).toEqual([])
  })

  it("survives an intent containing the field separator", () => {
    const tricky = [{ slug: "x", tier: "B", intent: "a | b | c" }]
    expect(parseIndex(renderIndex(tricky))).toEqual(tricky)
  })

  it("renders deterministically, sorted by slug", () => {
    expect(renderIndex(ENTRIES)).toBe(renderIndex([...ENTRIES].reverse()))
  })
})

describe("mergeEntry", () => {
  it("adds a feature the index has never seen", () => {
    const merged = mergeEntry(ENTRIES, { slug: "new-one", tier: "C", intent: "docs" })
    expect(merged).toHaveLength(3)
  })

  it("replaces a feature already there rather than duplicating it", () => {
    const merged = mergeEntry(ENTRIES, { slug: "rate-limit", tier: "A", intent: "changed" })
    expect(merged).toHaveLength(2)
    expect(merged.find((e) => e.slug === "rate-limit")).toMatchObject({ tier: "A", intent: "changed" })
  })
})

describe("rankEntries", () => {
  it("puts the entry sharing the most terms with the query first", () => {
    const ranked = rankEntries(ENTRIES, "session authentication tokens", 2)
    expect(ranked[0].slug).toBe("session-auth")
  })

  it("drops entries sharing nothing with the query", () => {
    expect(rankEntries(ENTRIES, "quantum chromodynamics", 3)).toEqual([])
  })

  it("honours the limit when more entries match than asked for", () => {
    expect(rankEntries(ENTRIES, "authentication limiting", 2)).toHaveLength(2)
    expect(rankEntries(ENTRIES, "authentication limiting", 1)).toHaveLength(1)
  })

  // "the", "add", "api" match nearly every spec ever written; matching on them would hand the
  // critic three arbitrary records and call it recall.
  it("drops terms under four characters, so a query of only short words matches nothing", () => {
    expect(rankEntries(ENTRIES, "add the api", 3)).toEqual([])
  })

  it("ignores case and short noise words", () => {
    expect(rankEntries(ENTRIES, "RATE LIMITING", 1)[0].slug).toBe("rate-limit")
  })

  it("is deterministic for ties — same input, same order", () => {
    const q = "adding"
    expect(rankEntries(ENTRIES, q, 5)).toEqual(rankEntries(ENTRIES, q, 5))
  })
})
