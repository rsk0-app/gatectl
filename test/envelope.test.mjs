import { describe, it, expect } from "vitest"
import { validateEnvelope, crossCheck, envelopeDigest, evidenceDigest, SCHEMA_VERSION } from "../src/core/envelope.mjs"

const HEAD = "a".repeat(40)
const BASE = "b".repeat(40)
const TREE = "c".repeat(40)
const POL = "d".repeat(64)
const SPEC = "e".repeat(64)

const ENV = {
  schema_version: SCHEMA_VERSION,
  repository: "org/repo",
  workflow_run_id: "123456",
  workflow_attempt: "1",
  head_sha: HEAD, base_sha: BASE, tree_oid: TREE,
  rda_version: "0.12.0", rda_binary_digest: "f".repeat(64),
  trusted_policy: { source_commit: BASE, digest: POL },
  candidate_policy_digest: POL,
  spec_digest: SPEC,
  evidence_digest: "1".repeat(64),
  gates: { Gfull: "PASS" },
  at: "2026-08-20T00:00:00.000Z",
}

const CONTEXT = { repository: "org/repo", workflow_run_id: "123456", workflow_attempt: "1", head_sha: HEAD, base_sha: BASE }
const GIT = { treeOf: (sha) => (sha === HEAD ? TREE : "9".repeat(40)), policyDigestAt: () => POL }

describe("envelope shape", () => {
  it("accepts a complete envelope", () => {
    expect(validateEnvelope(ENV)).toEqual({ ok: true, reasons: [] })
  })
  it("names every missing field rather than the first", () => {
    const { head_sha, tree_oid, ...rest } = ENV
    const r = validateEnvelope(rest)
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toContain("head_sha")
    expect(r.reasons.join()).toContain("tree_oid")
  })
  it("REFUSES an unknown field — a field the signer cannot check must not ride along signed", () => {
    const r = validateEnvelope({ ...ENV, overall: "PASS" })
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toContain("unknown field: overall")
  })
  it("REFUSES a schema version it does not understand, without looking further", () => {
    const r = validateEnvelope({ ...ENV, schema_version: 99 })
    expect(r.reasons).toHaveLength(1)
    expect(r.reasons[0]).toContain("unsupported schema_version")
  })
  it("REFUSES malformed identifiers and unknown gate statuses", () => {
    expect(validateEnvelope({ ...ENV, head_sha: "nope" }).reasons.join()).toContain("head_sha is not a commit id")
    expect(validateEnvelope({ ...ENV, gates: { Gfull: "GREENISH" } }).reasons.join()).toContain("unknown status")
  })
})

describe("digests", () => {
  it("the envelope digest ignores the signature fields it will carry", () => {
    expect(envelopeDigest(ENV)).toBe(envelopeDigest({ ...ENV, sig: "x", alg: "ed25519" }))
  })
  it("but changes when anything else moves", () => {
    expect(envelopeDigest({ ...ENV, tree_oid: "9".repeat(40) })).not.toBe(envelopeDigest(ENV))
  })
  it("the evidence digest is order-independent over the results", () => {
    expect(evidenceDigest({ a: 1, b: [2, 3] })).toBe(evidenceDigest({ b: [2, 3], a: 1 }))
  })
})

// The correction that matters: splitting the jobs buys nothing if the signer believes the file.
describe("crossCheck — the signer's own view, never the envelope's word", () => {
  it("passes when every claim matches the runner's context and git", () => {
    expect(crossCheck({ envelope: ENV, context: CONTEXT, git: GIT })).toEqual({ ok: true, reasons: [] })
  })

  it("REFUSES an envelope from another workflow run — a stolen artifact is not this run's evidence", () => {
    const r = crossCheck({ envelope: { ...ENV, workflow_run_id: "999" }, context: CONTEXT, git: GIT })
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toContain("workflow_run_id")
  })

  it("REFUSES a replayed attempt", () => {
    expect(crossCheck({ envelope: { ...ENV, workflow_attempt: "1" }, context: { ...CONTEXT, workflow_attempt: "2" }, git: GIT }).ok).toBe(false)
  })

  it("REFUSES evidence about another commit, or another repository", () => {
    expect(crossCheck({ envelope: { ...ENV, head_sha: "9".repeat(40) }, context: CONTEXT, git: GIT }).reasons.join()).toContain("head_sha")
    expect(crossCheck({ envelope: { ...ENV, repository: "org/other" }, context: CONTEXT, git: GIT }).reasons.join()).toContain("repository")
  })

  it("REFUSES a tree the head commit does not carry — git is asked, not the envelope", () => {
    const r = crossCheck({ envelope: { ...ENV, tree_oid: "9".repeat(40) }, context: CONTEXT, git: GIT })
    expect(r.reasons.join()).toContain("tree_oid")
  })

  // The authority rule.
  it("REFUSES a branch that changed the policy judging it", () => {
    const git = { ...GIT, policyDigestAt: (sha) => (sha === HEAD ? "0".repeat(64) : POL) }
    const r = crossCheck({ envelope: { ...ENV, candidate_policy_digest: "0".repeat(64) }, context: CONTEXT, git })
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toContain("modifies its own authority")
  })

  it("REFUSES trusted policy taken from anywhere but the pull request's base commit", () => {
    const r = crossCheck({ envelope: { ...ENV, trusted_policy: { source_commit: HEAD, digest: POL } }, context: CONTEXT, git: GIT })
    expect(r.reasons.join()).toContain("base commit")
  })

  it("REFUSES a policy digest that does not match the policy at that commit", () => {
    const git = { ...GIT, policyDigestAt: () => "7".repeat(64) }
    const r = crossCheck({ envelope: ENV, context: CONTEXT, git })
    expect(r.reasons.join()).toContain("does not match the policy at")
  })

  it("stays silent about context the signer does not have, rather than inventing a mismatch", () => {
    // A signer outside GitHub knows no run id; that is not evidence of forgery.
    expect(crossCheck({ envelope: ENV, context: { repository: "org/repo" }, git: GIT }).ok).toBe(true)
  })
})
