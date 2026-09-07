import { describe, it, expect } from "vitest"
import { gateX, reviewDigest, validateReview, verifyCitation, PROMPT_VERSION } from "../src/core/review.mjs"

const FILE = ["export function refresh(token) {", "  if (expired(token)) return null", "  return token", "}"]
const readLines = (f) => (f === "src/auth.ts" ? FILE : f === "test/auth.test.ts" ? ["it('rejects', () => {})"] : null)

const cite = (over = {}) => ({
  file: "src/auth.ts", start_line: 2, end_line: 2, quote: "  if (expired(token)) return null", ...over,
})
const COMPILED = {
  digest: "spec1",
  acceptance_criteria: [{ id: "AC-01" }],
  invariants: [{ id: "INV-01" }],
}
const REVIEW = {
  model: "reviewer-2", prompt_version: PROMPT_VERSION, tree: "t1", spec_digest: "spec1",
  claims: [
    { target: "AC-01", verdict: "implemented", reasoning: "expiry is checked", citations: [cite()] },
    { target: "INV-01", verdict: "implemented", reasoning: "sessions untouched", citations: [cite({ start_line: 3, end_line: 3, quote: "  return token" })] },
  ],
  findings: [],
  verdict: "APPROVE",
}
const BASE = { review: REVIEW, compiled: COMPILED, tree: "t1", changed: ["src/auth.ts"], implementer: "claude", readLines }

describe("citations name real code at the line they claim", () => {
  it("verifies a quote that matches the file", () => {
    const r = verifyCitation(cite(), readLines)
    expect(r.ok).toBe(true)
    expect(r.verified.span_digest).toMatch(/^[0-9a-f]{64}$/)
  })
  it("REFUSES a quote that is not what is there — the interesting forgery", () => {
    const r = verifyCitation(cite({ quote: "  if (somethingElse) return null" }), readLines)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("not what is there")
  })

  // Found by running it: models quote the right text and miscount the range by a line, routinely.
  // A check no model can satisfy blocks forever instead of catching anything, so the quote is
  // matched from the line it names and the end line is read back from the file.
  it("tolerates a miscounted end line when the text at the start line is right", () => {
    const r = verifyCitation(cite({ end_line: 2, quote: "  if (expired(token)) return null\n  return token" }), readLines)
    expect(r.ok).toBe(true)
    expect(r.verified.end_line).toBe(3)
  })

  it("still refuses a quote longer than what remains in the file", () => {
    const long = ["export function refresh(token) {", "  if (expired(token)) return null", "  return token", "}", "extra"].join("\n")
    expect(verifyCitation(cite({ start_line: 1, end_line: 5, quote: long }), readLines).ok).toBe(false)
  })
  it("REFUSES a file that is not in the tree, and a span past its end", () => {
    expect(verifyCitation(cite({ file: "src/nope.ts" }), readLines).reason).toContain("no such file")
    expect(verifyCitation(cite({ start_line: 9, end_line: 9 }), readLines).reason).toContain("the file has 4")
  })
  it("REFUSES a malformed range or a missing quote", () => {
    expect(verifyCitation(cite({ start_line: 3, end_line: 1 }), readLines).reason).toContain("is not a range")
    expect(verifyCitation({ file: "src/auth.ts", start_line: 1, end_line: 1 }, readLines).reason).toContain("quotes nothing")
  })
})

describe("review shape", () => {
  it("REFUSES a claim with no citation — an opinion is not a claim", () => {
    const review = { ...REVIEW, claims: [{ target: "AC-01", verdict: "implemented", citations: [] }] }
    expect(validateReview(review).errors.join()).toContain("cites nothing")
  })
  it("REFUSES duplicate or malformed finding ids", () => {
    const f = (id) => ({ id, severity: "high", title: "t" })
    expect(validateReview({ ...REVIEW, findings: [f("X-001"), f("X-001")] }).errors.join()).toContain("duplicate finding id")
    expect(validateReview({ ...REVIEW, findings: [f("oops")] }).errors.join()).toContain("must look like X-001")
  })
  it("REFUSES a review produced by a prompt this rda does not speak", () => {
    expect(validateReview({ ...REVIEW, prompt_version: 1 }).errors.join()).toContain("prompt version")
  })
})

describe("gate X", () => {
  it("PASSes a review that accounts for everything and cites the diff", () => {
    const r = gateX(BASE)
    expect(r.status).toBe("PASS")
    expect(r.coverage).toMatchObject({ targets: 2, in_diff: 2 })
  })

  // The rule that replaced "found nothing is not approval".
  it("finding nothing is a legitimate outcome — having looked at nothing is not", () => {
    expect(gateX(BASE).status).toBe("PASS")
    const half = { ...REVIEW, claims: [REVIEW.claims[0]] }
    const r = gateX({ ...BASE, review: half })
    expect(r.status).toBe("NOT_EVALUATED")
    expect(r.reasons.join()).toContain("INV-01 is not addressed")
  })

  it("REFUSES a review whose citations all point outside the diff", () => {
    const elsewhere = { ...BASE, changed: ["src/other.ts"] }
    expect(gateX(elsewhere).reasons.join()).toContain("not about this change")
  })

  it("REFUSES a criterion the reviewer could not confirm", () => {
    const unsure = { ...REVIEW, claims: [{ ...REVIEW.claims[0], verdict: "unclear" }, REVIEW.claims[1]] }
    expect(gateX({ ...BASE, review: unsure }).reasons.join()).toContain('AC-01: the reviewer says "unclear"')
  })

  it("REFUSES a review of another tree or another version of the spec", () => {
    expect(gateX({ ...BASE, tree: "t2" }).reasons.join()).toContain("re-run")
    expect(gateX({ ...BASE, compiled: { ...COMPILED, digest: "spec2" } }).reasons.join()).toContain("different version of the spec")
  })

  // The rule that matters, and the one an earlier version got wrong: the reviewer must not be
  // the model that wrote the code. Whether it also critiqued the spec is irrelevant — different
  // artifact, different moment, and one adversary who knows the spec is an asset.
  it("REFUSES a review by the model that wrote the code", () => {
    const own = { ...REVIEW, model: "claude-opus-4-6" }
    const r = gateX({ ...BASE, review: own, implementer: "claude" })
    expect(r.status).toBe("NOT_EVALUATED")
    expect(r.reasons.join()).toContain("does not review its own work")
  })

  it("ALLOWS the spec critic and the diff reviewer to be the same outside model", () => {
    // codex argued with the spec and now argues with the diff; claude wrote the code.
    expect(gateX({ ...BASE, review: { ...REVIEW, model: "gpt-5.6-sol" }, implementer: "claude" }).status).toBe("PASS")
  })

  it("FAILs on an unresolved high finding and names it by stable id", () => {
    const review = { ...REVIEW, verdict: "CHANGES_REQUESTED",
      findings: [{ id: "X-001", severity: "high", title: "expiry uses the wrong clock" }] }
    const r = gateX({ ...BASE, review })
    expect(r.status).toBe("FAIL")
    expect(r.reasons.join()).toContain("X-001 high: expiry uses the wrong clock")
    expect(r.reasons.join()).toContain("accept one in writing")
  })

  it("medium and low findings do not block", () => {
    const review = { ...REVIEW, findings: [{ id: "X-002", severity: "medium", title: "naming" }] }
    expect(gateX({ ...BASE, review }).status).toBe("PASS")
  })

  it("an acceptance recorded in writing clears a severe finding, and says so out loud", () => {
    const review = { ...REVIEW, findings: [{ id: "X-001", severity: "high", title: "known gap" }] }
    const r = gateX({ ...BASE, review, acceptances: [{ finding: "X-001", title: "known gap", tree: BASE.tree, digest: BASE.compiled.digest, review_digest: reviewDigest(review), reason: "shipping behind a flag" }] })
    expect(r.status).toBe("PASS")
    expect(r.reasons.join()).toContain("accepted in writing: X-001")
  })

  it("an acceptance does not carry over to a different finding wearing the same id", () => {
    // Ids are handed out per review: `X-001` in one round is a different objection from `X-001`
    // in the next. An acceptance that matched on the id alone would clear a finding nobody ever
    // read — which is how a decision about one problem becomes a blanket exemption.
    const review = { ...REVIEW, findings: [{ id: "X-001", severity: "high", title: "a different gap" }] }
    const stale = [{ finding: "X-001", title: "known gap", reason: "shipping behind a flag" }]
    expect(gateX({ ...BASE, review, acceptances: stale }).status).toBe("FAIL")
  })

  it("an unconfirmed criterion can be accepted in writing, like a finding", () => {
    // The same objection arrives either way — as a finding one day, as `AC-01: not_implemented`
    // the next — and only the first could be answered with a decision. Which form a model chose
    // is not a property of the objection.
    const review = {
      ...REVIEW,
      claims: [
        { target: "AC-01", verdict: "not_implemented", rationale: "scope", citations: REVIEW.claims[0].citations },
        REVIEW.claims[1],
      ],
    }
    const blocked = gateX({ ...BASE, review })
    expect(blocked.status).toBe("NOT_EVALUATED")
    const accepted = gateX({
      ...BASE, review,
      acceptances: [{ criterion: "AC-01", tree: BASE.tree, review_digest: reviewDigest(review), digest: BASE.compiled.digest, reason: "deferred on purpose" }],
    })
    expect(accepted.status, accepted.reasons?.join()).toBe("PASS")
    expect(accepted.reasons.join()).toContain("accepted in writing: AC-01")
  })

  it("a criterion acceptance does not survive the criterion being reworded", () => {
    // Bound to the spec digest: rewrite what the criterion says and the decision is about
    // something else, so it has to be taken again.
    const review = {
      ...REVIEW,
      claims: [
        { target: "AC-01", verdict: "not_implemented", rationale: "scope", citations: REVIEW.claims[0].citations },
        REVIEW.claims[1],
      ],
    }
    const r = gateX({
      ...BASE, review,
      acceptances: [{ criterion: "AC-01", digest: "a-different-spec-digest", reason: "deferred on purpose" }],
    })
    expect(r.status).toBe("NOT_EVALUATED")
  })

  it("an acceptance for a different finding clears nothing", () => {
    const review = { ...REVIEW, findings: [{ id: "X-001", severity: "critical", title: "auth bypass" }] }
    expect(gateX({ ...BASE, review, acceptances: [{ finding: "X-009" }] }).status).toBe("FAIL")
  })

  it("NOT_EVALUATED with no review, and on an empty diff", () => {
    expect(gateX({ ...BASE, review: null }).reasons.join()).toContain("gatectl review")
    expect(gateX({ ...BASE, changed: [] }).status).toBe("NOT_EVALUATED")
  })
})

// A model counting lines by eye lands one off — at the end of a span, and equally at the start.
// The first was already tolerated; the second failed a review whose quotes were all genuinely in
// the file, one line below where they were claimed. A check no model can satisfy blocks forever
// instead of catching anything, and text found two lines away is not a fabrication.
describe("a citation whose start line is off by one", () => {
  const FILE = ["alpha", "beta", "function target() {", "  return 1", "}", "omega"]
  const readLines = (f) => (f === "src/x.mjs" ? FILE : null)

  it("verifies, and records the line the file actually has", () => {
    const r = verifyCitation(
      { file: "src/x.mjs", start_line: 4, end_line: 6, quote: "function target() {\n  return 1" },
      readLines,
    )
    expect(r.ok, r.reason).toBe(true)
    expect(r.verified.start_line).toBe(3)
    expect(r.verified.end_line).toBe(4)
  })

  it("accepts text that is in the file however far off the line number is", () => {
    // The number is not the claim. A quote that is really in the file has been read, whatever
    // arithmetic the reviewer did on its way out — and the verdict records where it actually is.
    const r = verifyCitation(
      { file: "src/x.mjs", start_line: 6, end_line: 6, quote: "function target() {" },
      readLines,
    )
    expect(r.ok, r.reason).toBe(true)
    expect(r.verified.start_line).toBe(3)
  })

  it("resolves a repeated quote to the occurrence nearest the line named", () => {
    const twice = ["x", "return 1", "y", "z", "return 1", "w"]
    const r = verifyCitation(
      { file: "src/y.mjs", start_line: 5, end_line: 5, quote: "return 1" },
      (f) => (f === "src/y.mjs" ? twice : null),
    )
    expect(r.ok, r.reason).toBe(true)
    expect(r.verified.start_line).toBe(5)
  })

  it("still REFUSES text that is not in the file at all", () => {
    const r = verifyCitation(
      { file: "src/x.mjs", start_line: 3, end_line: 3, quote: "function invented() {" },
      readLines,
    )
    expect(r.ok).toBe(false)
  })
})
