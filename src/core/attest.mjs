// src/core/attest.mjs — what a green commit-check actually hands over.
//
// A gate ledger says "these gates passed"; an attestation says WHAT they passed over, in terms
// anyone can recompute from git alone: the exact tree the commit carries, the spec digest, the
// policy digest, the tier and its requirements. Signed, so it cannot be written by the thing
// being judged; verifiable by a process that holds nothing but the key and the repository.
//
// `gatectl verify` is the consumer that matters: run in CI against a commit SHA, it re-derives
// every digest from that commit and refuses an attestation that does not match — a green
// earned on a different tree, an older spec, or a loosened policy is not a green for this one.
import crypto from "node:crypto"

// Key order must not change the signature, so the payload is serialised with sorted keys. `mac`
// is never part of what it signs.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().filter((k) => k !== "mac" && k !== "sig" && value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
  return JSON.stringify(value ?? null)
}

const sign = (att, key) => crypto.createHmac("sha256", key).update(canonical(att)).digest("hex")

// #7: a gate result says WHAT happened; the environment says where. Two machines can disagree
// about the same commit — a different node, a different platform, a policy whose commands were
// rewritten between runs — and without this the evidence cannot say why. It is recorded and
// reported, never compared for equality: a verifier running elsewhere is the point of verifying,
// so a different environment is expected, not a failure.
export function environment({ versions = process.versions, platform = process.platform, arch = process.arch, commands = {} }) {
  const env = {
    node: versions.node ?? null,
    platform, arch,
    // The commands themselves, not their output: a green earned with `test_all: "true"` and one
    // earned with a real suite must not look alike in the record.
    commands: Object.fromEntries(Object.entries(commands).filter(([, v]) => v !== undefined).sort()),
  }
  return { ...env, digest: crypto.createHash("sha256").update(canonical(env)).digest("hex").slice(0, 16) }
}

export const signAttestation = (att, key) => ({ ...att, mac: sign(att, key) })

// Two signature schemes, for two different jobs.
//
//   HMAC (above)     — a local record, verified on the machine that wrote it. Symmetric: whoever
//                      can check it can also produce it. Fine when writer and reader are the
//                      same principal, useless as proof to anyone else.
//   Ed25519 (below)  — an ISSUED record. The private key signs, the public key only checks, and
//                      one cannot be derived from the other. The public half can be published,
//                      committed, pasted into a README; only the holder of the private half can
//                      sign. This is what makes a verdict mean something to someone who was not
//                      there when it was produced.
//
// A local commit-check keeps HMAC: it is a claim, addressed to its own author. An issuer — CI,
// re-running the gates on a clean checkout — signs with Ed25519, because its whole purpose is to
// be believed by people who cannot and should not hold its key.
export function signIssued(att, privateKey) {
  const body = { ...att, alg: "ed25519" }
  delete body.sig
  return { ...body, sig: crypto.sign(null, Buffer.from(canonical(body)), privateKey).toString("base64") }
}

export function verifyIssued(att, publicKey) {
  if (!att || att.alg !== "ed25519" || typeof att.sig !== "string") return false
  const body = { ...att }
  delete body.sig
  try {
    return crypto.verify(null, Buffer.from(canonical(body)), publicKey, Buffer.from(att.sig, "base64"))
  } catch { return false }
}

// An issued record — from `verify --rerun --issue` (commit, tree, policy_digest) or from `attest`
// over an evidence envelope (head_sha, tree_oid, trusted_policy) — held against what the verified
// commit carries. Every expected value is derived from that commit by the caller; the record never
// supplies one, or it would be checking itself. A commit without a spec expects a record that
// states none: null, or the envelope's all-zero digest.
export function checkIssued({ att, tree, sha, specDigest, policyDigest }) {
  const reasons = []
  const commit = att.commit ?? att.head_sha
  const issuedTree = att.tree ?? att.tree_oid
  const policy = att.policy_digest ?? att.trusted_policy?.digest
  if (commit !== sha) reasons.push(`issued for commit ${String(commit).slice(0, 12)}…, not ${sha.slice(0, 12)}…`)
  if (issuedTree !== tree) reasons.push(`attested tree ${String(issuedTree).slice(0, 12)}… is not this commit's tree ${tree.slice(0, 12)}…`)
  // A missing field states nothing; only an explicit null or the all-zero digest says "no spec".
  const noSpec = att.spec_digest === null || /^0{64}$/.test(String(att.spec_digest))
  if (specDigest === null ? !noSpec : att.spec_digest !== specDigest)
    reasons.push("the spec at this commit is not the spec the issuer judged")
  if (policy !== policyDigest) reasons.push("the policy at this commit is not the policy the issuer judged under")
  return { ok: reasons.length === 0, reasons }
}

export function verifySignature(att, key) {
  if (!att || typeof att.mac !== "string") return false
  const expected = Buffer.from(sign(att, key), "hex")
  const actual = Buffer.from(att.mac, "hex")
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

// The independent check. Every argument except the attestation itself is derived from the
// repository at the commit under test — never read out of the attestation, which is the thing
// being doubted.
export function checkAttestation({ att, key, tree, specDigest, policyDigest, requires, skipSignature = false }) {
  if (!att) return { ok: false, reasons: ["no attestation"] }
  // `skipSignature` is for callers that already checked one — an issued record verifies under a
  // public key, which this function has no business knowing about. It never means "unchecked":
  // the caller that passes it has done the check and refused already if it failed.
  if (!skipSignature && !verifySignature(att, key))
    return { ok: false, reasons: ["signature does not verify — wrong key, or the attestation was edited"] }
  const reasons = []
  if (att.tree !== tree) reasons.push(`attested tree ${String(att.tree).slice(0, 12)}… is not this commit's tree ${tree.slice(0, 12)}…`)
  if (att.spec_digest !== specDigest) reasons.push("the spec at this commit is not the spec that was gated")
  if (att.policy_digest !== policyDigest) reasons.push("the policy at this commit is not the policy that was gated")
  // The requirements are re-derived from the policy at this commit, so a policy that quietly
  // dropped a gate cannot make an old attestation cover the new, weaker set.
  if (requires) {
    const attested = new Set(att.gates?.filter((g) => g.status === "PASS").map((g) => g.gate) ?? [])
    for (const gate of requires) if (!attested.has(gate)) reasons.push(`gate ${gate} is required by this commit's policy but not attested green`)
  }
  return { ok: reasons.length === 0, reasons }
}
