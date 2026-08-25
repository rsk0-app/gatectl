// src/core/envelope.mjs — the evidence envelope, and the rule that a signer never believes it.
//
// The split this exists for: one process runs the repository's code, another signs. Splitting
// the jobs alone buys nothing if the signer signs whatever lands in front of it — the attack
// simply moves from "steal the key" to "hand the signer a forged PASS". So the envelope is not
// a report the signer trusts; it is a set of CLAIMS the signer re-checks against its own view of
// the world: its GitHub context, and git itself.
//
// Every field here is therefore one of two kinds, and it matters which:
//
//   cross-checkable — repository, run id, head/base sha, tree oid, policy digests. The signer
//                     compares each against a source the candidate branch cannot write.
//   recorded        — command results, timings, environment. The signer cannot re-derive these
//                     without running the code again, which is exactly what it must not do. They
//                     are attested as "the runner said this", never as "this is true".
//
// Being clear about which is which is the whole value. A verdict that blurred them would be the
// overstatement this engine exists to prevent, one level up.
import crypto from "node:crypto"
import { canonical } from "./attest.mjs"

export const SCHEMA_VERSION = 1

const SHA1 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

const REQUIRED = [
  "schema_version", "repository", "workflow_run_id", "workflow_attempt",
  "head_sha", "base_sha", "tree_oid", "rda_version", "rda_binary_digest",
  "trusted_policy", "candidate_policy_digest", "spec_digest", "evidence_digest", "gates", "at",
]
const OPTIONAL = ["feature", "tier", "requires", "reran", "not_rerun", "env", "issuer", "sandbox"]

// The digest a signature is over. Computed from the whole envelope minus the signature fields,
// so a signer states exactly one thing: "this envelope, in this shape, was checked and signed".
export const envelopeDigest = (env) =>
  crypto.createHash("sha256").update(canonical({ ...env, sig: undefined, alg: undefined })).digest("hex")

// The results half, digested separately so the envelope can carry a stable handle to it and a
// reader can tell at a glance whether two runs saw the same thing.
export const evidenceDigest = (results) =>
  crypto.createHash("sha256").update(canonical(results)).digest("hex")

export function validateEnvelope(env) {
  const reasons = []
  if (!env || typeof env !== "object") return { ok: false, reasons: ["evidence is not an object"] }
  if (env.schema_version !== SCHEMA_VERSION)
    return { ok: false, reasons: [`unsupported schema_version ${env.schema_version} (this gatectl understands ${SCHEMA_VERSION})`] }

  for (const key of REQUIRED) if (env[key] === undefined || env[key] === null) reasons.push(`missing field: ${key}`)
  // Unknown top-level keys are refused rather than ignored: a field a signer does not understand
  // is a field it cannot check, and signing it would lend it authority anyway.
  for (const key of Object.keys(env))
    if (!REQUIRED.includes(key) && !OPTIONAL.includes(key) && !["sig", "alg"].includes(key))
      reasons.push(`unknown field: ${key}`)

  if (env.head_sha && !SHA1.test(env.head_sha)) reasons.push("head_sha is not a commit id")
  if (env.base_sha && !SHA1.test(env.base_sha)) reasons.push("base_sha is not a commit id")
  if (env.tree_oid && !SHA1.test(env.tree_oid)) reasons.push("tree_oid is not a tree id")
  if (env.spec_digest && !SHA256.test(env.spec_digest)) reasons.push("spec_digest is not a sha256")
  if (env.candidate_policy_digest && !SHA256.test(env.candidate_policy_digest)) reasons.push("candidate_policy_digest is not a sha256")
  if (env.trusted_policy && !SHA256.test(env.trusted_policy.digest ?? "")) reasons.push("trusted_policy.digest is not a sha256")
  if (env.trusted_policy && !SHA1.test(env.trusted_policy.source_commit ?? "")) reasons.push("trusted_policy.source_commit is not a commit id")
  if (env.gates && typeof env.gates !== "object") reasons.push("gates is not an object")
  for (const [gate, status] of Object.entries(env.gates ?? {}))
    if (!["PASS", "FAIL", "NOT_EVALUATED"].includes(status)) reasons.push(`gate ${gate} has an unknown status: ${status}`)
  return { ok: reasons.length === 0, reasons }
}

// The signer's own view, never the envelope's word for it.
//
//   context — read from the signer's environment (GitHub gives these to the job; the candidate
//             branch cannot set them for someone else's run).
//   git     — callbacks that answer from the repository: the tree of a commit, the policy digest
//             at a commit. The candidate can control what is AT its own head; it cannot change
//             what is at the base it was branched from.
export function crossCheck({ envelope: e, context, git }) {
  const reasons = []
  const differ = (field, mine, theirs) => {
    if (mine === undefined || mine === null || mine === "") return // the signer does not know; say nothing
    if (String(theirs) !== String(mine)) reasons.push(`${field}: evidence says ${theirs}, this runner is ${mine}`)
  }
  differ("repository", context.repository, e.repository)
  differ("workflow_run_id", context.workflow_run_id, e.workflow_run_id)
  differ("workflow_attempt", context.workflow_attempt, e.workflow_attempt)
  differ("head_sha", context.head_sha, e.head_sha)
  differ("base_sha", context.base_sha, e.base_sha)

  const tree = git.treeOf(e.head_sha)
  if (tree !== e.tree_oid) reasons.push(`tree_oid: evidence says ${String(e.tree_oid).slice(0, 12)}…, ${String(e.head_sha).slice(0, 12)} carries ${String(tree).slice(0, 12)}…`)

  // Authority lives at the base commit, which the candidate cannot rewrite. Reading it from a
  // branch name instead would be a race: main can move between the run and the signature.
  const trustedAt = git.policyDigestAt(e.trusted_policy?.source_commit)
  if (e.trusted_policy?.source_commit !== e.base_sha)
    reasons.push("trusted policy was not taken from this pull request's base commit")
  if (trustedAt !== e.trusted_policy?.digest)
    reasons.push("trusted policy digest does not match the policy at that commit")

  const candidateAt = git.policyDigestAt(e.head_sha)
  if (candidateAt !== e.candidate_policy_digest)
    reasons.push("candidate policy digest does not match the policy at the head commit")

  // The rule that closes the loop: a branch may not relax the authority that judges it. Changing
  // policy is legitimate — through its own pull request, reviewed as the meta-class change it is,
  // and then everything else rebases onto it.
  if (e.candidate_policy_digest !== e.trusted_policy?.digest)
    reasons.push("candidate modifies its own authority — the policy differs from the base commit's; land a policy change in its own reviewed pull request")

  return { ok: reasons.length === 0, reasons }
}
