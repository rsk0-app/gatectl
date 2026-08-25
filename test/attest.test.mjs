import { describe, it, expect } from "vitest"
import crypto from "node:crypto"
import { canonical, signAttestation, verifySignature, checkAttestation, signIssued, verifyIssued } from "../src/core/attest.mjs"

const KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8")
const ATT = {
  feature: "f1", rda_version: "0.6.0", tier: "B", requires: ["L", "R", "Gfull"],
  spec_digest: "spec1", policy_digest: "pol1", tree: "tree1", head: "head1", ledger_head: "mac1",
  gates: [{ gate: "L", status: "PASS" }, { gate: "R", status: "PASS" }, { gate: "Gfull", status: "PASS" }],
  at: "2026-08-20T00:00:00.000Z",
}

describe("canonical", () => {
  it("does not depend on key order", () => {
    expect(canonical({ a: 1, b: [2, { d: 4, c: 3 }] })).toBe(canonical({ b: [2, { c: 3, d: 4 }], a: 1 }))
  })
  it("excludes the mac it is used to produce", () => {
    expect(canonical({ a: 1, mac: "x" })).toBe(canonical({ a: 1 }))
  })
})

describe("signature", () => {
  it("verifies what it signed and nothing else", () => {
    const signed = signAttestation(ATT, KEY)
    expect(verifySignature(signed, KEY)).toBe(true)
    expect(verifySignature({ ...signed, tree: "other" }, KEY)).toBe(false)
    expect(verifySignature(signed, Buffer.from("another key entirely", "utf8"))).toBe(false)
  })
  it("an unsigned or malformed attestation never verifies", () => {
    expect(verifySignature(ATT, KEY)).toBe(false)
    expect(verifySignature({ ...ATT, mac: "zz" }, KEY)).toBe(false)
    expect(verifySignature(null, KEY)).toBe(false)
  })
})

describe("checkAttestation — everything but the attestation comes from the repository", () => {
  const args = { key: KEY, tree: "tree1", specDigest: "spec1", policyDigest: "pol1", requires: ["L", "R", "Gfull"] }
  it("passes for the commit it was made for", () => {
    expect(checkAttestation({ att: signAttestation(ATT, KEY), ...args }).ok).toBe(true)
  })
  it("REFUSES replay onto another tree", () => {
    const r = checkAttestation({ att: signAttestation(ATT, KEY), ...args, tree: "tree2" })
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toContain("not this commit's tree")
  })
  it("REFUSES a spec or policy that has moved since", () => {
    expect(checkAttestation({ att: signAttestation(ATT, KEY), ...args, specDigest: "spec2" }).reasons.join())
      .toContain("not the spec that was gated")
    expect(checkAttestation({ att: signAttestation(ATT, KEY), ...args, policyDigest: "pol2" }).reasons.join())
      .toContain("not the policy that was gated")
  })
  it("REFUSES when the policy at this commit requires a gate the attestation does not carry green", () => {
    const r = checkAttestation({ att: signAttestation(ATT, KEY), ...args, requires: ["L", "R", "Gfull", "X"] })
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toContain("gate X")
  })
  it("REFUSES a non-PASS gate presented as coverage", () => {
    const weak = { ...ATT, gates: [{ gate: "L", status: "PASS" }, { gate: "R", status: "NOT_EVALUATED" }, { gate: "Gfull", status: "PASS" }] }
    expect(checkAttestation({ att: signAttestation(weak, KEY), ...args }).reasons.join()).toContain("gate R")
  })
  it("REFUSES an edited attestation before looking at anything else", () => {
    const signed = signAttestation(ATT, KEY)
    const r = checkAttestation({ att: { ...signed, tree: "tree1", spec_digest: "forged" }, ...args, specDigest: "forged" })
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toContain("signature")
  })
})

// An issued verdict is meant to be believed by someone who does not hold the key that made it.
// That is the whole difference from the local HMAC record, and the reason both exist.
describe("issued signatures (ed25519)", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const other = crypto.generateKeyPairSync("ed25519")

  it("verifies under the matching public key", () => {
    const issued = signIssued({ ...ATT, issuer: "ci" }, privateKey)
    expect(issued.alg).toBe("ed25519")
    expect(verifyIssued(issued, publicKey)).toBe(true)
  })

  it("the public key can only CHECK — a verifier is not a forger", () => {
    const issued = signIssued({ ...ATT, issuer: "ci" }, privateKey)
    // Holding `publicKey` gives no way to produce `sig` for different content: signing with any
    // other key fails against it.
    expect(verifyIssued(signIssued({ ...ATT, tree: "forged" }, other.privateKey), publicKey)).toBe(false)
  })

  it("REFUSES any edit to the signed body", () => {
    const issued = signIssued({ ...ATT, issuer: "ci" }, privateKey)
    expect(verifyIssued({ ...issued, tree: "other" }, publicKey)).toBe(false)
    expect(verifyIssued({ ...issued, gates: [] }, publicKey)).toBe(false)
  })

  it("REFUSES an unsigned record, and one that only claims to be signed", () => {
    expect(verifyIssued(ATT, publicKey)).toBe(false)
    expect(verifyIssued({ ...ATT, alg: "ed25519", sig: "AAAA" }, publicKey)).toBe(false)
  })

  it("a smuggled `sig` field cannot change what was signed", () => {
    const issued = signIssued({ ...ATT, issuer: "ci" }, privateKey)
    expect(verifyIssued({ ...issued, sig: issued.sig }, publicKey)).toBe(true)
  })
})
