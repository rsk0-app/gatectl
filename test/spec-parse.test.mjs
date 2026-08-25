import { describe, it, expect } from "vitest"
import { parseSpec } from "../src/core/spec.mjs"

const FULL = `# csv-export

state: DRAFT
mvp_ref: operator-can-export

## Intent
Логист выгружает заявки в csv, который без правок грузится в 1С.

## Invariants
- I1 Export is org-scoped.

## Acceptance Criteria
- AC1 given rows, export produces a file — required: test/export.test.ts
- AC2 encoding is UTF-8 BOM — required: test/export.test.ts, test/encoding.test.ts

## Allowed Paths
- src/lib/export/**
- test/**

## Rollback
Feature-flagged; disable the flag.
`

describe("parseSpec", () => {
  it("parses all sections of a complete spec", () => {
    const s = parseSpec(FULL)
    expect(s.state).toBe("DRAFT")
    expect(s.mvpRef).toBe("operator-can-export")
    expect(s.intent).toContain("1С")
    expect(s.invariants).toHaveLength(1)
    expect(s.acceptanceCriteria).toHaveLength(2)
    expect(s.requiredTests).toEqual(["test/export.test.ts", "test/encoding.test.ts"])
    expect(s.allowedPaths).toEqual(["src/lib/export/**", "test/**"])
    expect(s.missingSections).toEqual([])
    expect(s.blockingQuestions).toEqual([])
  })
  it("collects BLOCKING questions from anywhere", () => {
    const s = parseSpec(FULL + "\nBLOCKING: какой разделитель нужен 1С?\n")
    expect(s.blockingQuestions).toEqual(["какой разделитель нужен 1С?"])
  })
  it("names every missing required section", () => {
    const s = parseSpec("# x\n\nstate: DRAFT\n\n## Intent\nsomething\n")
    expect(s.missingSections).toEqual(
      expect.arrayContaining(["invariants", "acceptance_criteria", "allowed_paths", "rollback", "mvp_ref"]),
    )
  })
  it("an AC without a required test is visible", () => {
    const s = parseSpec(FULL.replace(" — required: test/export.test.ts\n", "\n"))
    expect(s.acceptanceCriteriaWithoutTests).toHaveLength(1)
  })
})

// #5: "the file failed" is weaker than it looks. A file can go red because of a different test,
// a syntax error, a missing dependency, or a runner that never got there. An acceptance
// criterion may therefore name the exact case it is about, and gate R confirms THAT case.
describe("test obligations", () => {
  const spec = (acs) => parseSpec(`# f

state: DRAFT
mvp_ref: works

## Intent
x

## Invariants
- I1 x

## Acceptance Criteria
${acs}

## Allowed Paths
- src/**

## Rollback
flag
`)

  it("parses a bare file as an obligation with no selector — the old form still works", () => {
    const s = spec("- AC1 x — required: test/a.test.ts")
    expect(s.testObligations).toEqual([{ ac: "AC1", file: "test/a.test.ts", selector: null }])
    expect(s.requiredTests).toEqual(["test/a.test.ts"])
  })

  it("parses file::\"selector\" and keeps the selector verbatim, spaces and all", () => {
    const s = spec('- AC3 x — required: test/auth.test.ts::"rejects an expired refresh token"')
    expect(s.testObligations).toEqual([
      { ac: "AC3", file: "test/auth.test.ts", selector: "rejects an expired refresh token" },
    ])
    expect(s.requiredTests).toEqual(["test/auth.test.ts"]) // digests still bind to files
  })

  it("a comma inside a quoted selector does not split the list", () => {
    const s = spec('- AC1 x — required: test/a.test.ts::"rejects a, b and c", test/b.test.ts')
    expect(s.testObligations.map((o) => o.file)).toEqual(["test/a.test.ts", "test/b.test.ts"])
    expect(s.testObligations[0].selector).toBe("rejects a, b and c")
  })

  it("two criteria may name two cases in one file — each is its own obligation", () => {
    const s = spec([
      '- AC1 signs in — required: test/auth.test.ts::"signs a user in"',
      '- AC2 expires — required: test/auth.test.ts::"rejects an expired token"',
    ].join("\n"))
    expect(s.testObligations).toHaveLength(2)
    expect(s.requiredTests).toEqual(["test/auth.test.ts"]) // one file, hashed once
  })

  it("an unquoted selector is taken to the end of the entry", () => {
    const s = spec("- AC1 x — required: test/a.test.ts::rejects an expired token")
    expect(s.testObligations[0].selector).toBe("rejects an expired token")
  })
})
