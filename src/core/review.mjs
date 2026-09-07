// src/core/review.mjs — gate X, and the difference between a review and a rubber stamp.
//
// The old rule was "a review that found nothing is NOT_EVALUATED". It was aimed at the right
// problem — an empty page is indistinguishable from a model that was never asked — but it paid
// for findings, and what you pay for you get: invented nits, so the gate would go green.
//
// The rule here is different. A reviewer is not asked to find something; it is asked to ACCOUNT
// for everything: every acceptance criterion and every invariant in the compiled spec, each with
// a verdict and with citations into the actual code. Finding nothing is a legitimate outcome —
// finding nothing while having looked at nothing is not, and the difference is now checkable.
//
// What is deterministic here, and what is not, stated plainly because the distinction is the
// whole point:
//
//   deterministic — that the review is about THIS tree and THIS spec; that every criterion and
//                   invariant is accounted for; that every citation names real code at the line
//                   it claims, and that at least one of them lands in the diff; that findings
//                   carry stable ids and that critical/high ones are either gone in a later
//                   review or explicitly accepted, in writing, in the signed ledger.
//   NOT deterministic — whether the model's reasoning is any good. That is a model's judgement,
//                   it varies between runs, and no amount of schema makes it repeatable. gatectl
//                   binds it and checks its shape; it does not pretend to verify its content.
import crypto from "node:crypto"

export const PROMPT_VERSION = 2
const SEVERE = new Set(["critical", "high"])
const VERDICTS = new Set(["implemented", "not_implemented", "unclear"])
const FINDING_ID = /^X-\d{3}$/

const isStr = (v) => typeof v === "string" && v.trim().length > 0

// A model cannot compute a git blob id, so it is not asked to. It quotes the code it is talking
// about, with the lines it claims to be quoting; gatectl checks the quote against the file and
// stamps the digests itself. The forgery this closes: citing a line number that exists but says
// something else, or quoting code that is not in the tree at all.
export function verifyCitation(citation, readLines) {
  if (!isStr(citation?.file)) return { ok: false, reason: "citation names no file" }
  const start = Number(citation.start_line)
  const end = Number(citation.end_line)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start)
    return { ok: false, reason: `${citation.file}: line span ${citation.start_line}-${citation.end_line} is not a range` }
  if (!isStr(citation.quote)) return { ok: false, reason: `${citation.file}:${start}: citation quotes nothing` }

  const lines = readLines(citation.file)
  if (lines === null) return { ok: false, reason: `${citation.file}: no such file in this tree` }
  if (start > lines.length) return { ok: false, reason: `${citation.file}: cites line ${start}, the file has ${lines.length}` }

  // The quote is checked against the file FROM the line it names, over as many lines as the
  // quote itself has — not against the exact span the reviewer declared. Models quote the right
  // text and miscount the range by a line routinely, and an anti-fabrication check that no model
  // can satisfy is a check that blocks forever rather than one that catches anything. What must
  // hold is that this text is really there, at this place; the end line is then whatever the
  // quote actually covers, recorded from the file rather than taken on trust.
  //
  // The line number is not the claim. The QUOTE is: if that text is in the file, where it sits is
  // determined by the text itself, and the number only offers a chance to be wrong — which models
  // take, at the start of a span as readily as at the end. A narrow window around the named line
  // was the first attempt and it failed on a citation three lines out, correct in every other way.
  //
  // So the quote is looked for in the whole file, and the occurrence NEAREST the named line is the
  // one recorded. What the check still refuses is a citation whose text is not in the file at all,
  // which is the fabrication it exists to catch. A reviewer that cites real code and miscounts has
  // read it; one that cites code the file does not contain has not.
  const quoted = citation.quote.replace(/\r/g, "").replace(/\s+$/, "").split("\n")
  const norm = (t) => t.replace(/\r/g, "").replace(/[ \t]+$/gm, "").trim()
  const wanted = norm(citation.quote)
  let matchedStart = null, actual = null, actualEnd = null
  for (let candidate = 1; candidate + quoted.length - 1 <= lines.length + 1; candidate++) {
    const endAt = Math.min(candidate - 1 + quoted.length, lines.length)
    const text = lines.slice(candidate - 1, endAt).join("\n")
    if (norm(text) !== wanted) continue
    // Nearest the line the reviewer named, so a quote appearing twice resolves to the one they
    // were most likely looking at rather than to whichever came first in the file.
    if (matchedStart === null || Math.abs(candidate - start) < Math.abs(matchedStart - start)) {
      matchedStart = candidate
      actual = text
      actualEnd = endAt
    }
  }
  if (matchedStart === null)
    return { ok: false, reason: `${citation.file}:${start}: the quoted text is not what is there` }

  return {
    ok: true,
    verified: {
      file: citation.file, start_line: matchedStart, end_line: actualEnd,
      span_digest: crypto.createHash("sha256").update(actual).digest("hex"),
    },
  }
}

// Shape first: a review gatectl cannot read is not a review with problems, it is not a review.
export function validateReview(review) {
  const errors = []
  if (!review || typeof review !== "object") return { ok: false, errors: ["review is not an object"] }
  if (!isStr(review.tree)) errors.push("review names no tree")
  if (review.prompt_version !== PROMPT_VERSION)
    errors.push(`review was produced by prompt version ${review.prompt_version ?? "?"}, this gatectl speaks ${PROMPT_VERSION}`)
  if (!Array.isArray(review.claims)) errors.push("review has no claims list")
  if (!Array.isArray(review.findings)) errors.push("review has no findings list")
  if (!["APPROVE", "CHANGES_REQUESTED"].includes(review.verdict))
    errors.push(`verdict must be APPROVE or CHANGES_REQUESTED — got ${JSON.stringify(review.verdict)}`)

  const ids = new Set()
  for (const [i, f] of (review.findings ?? []).entries()) {
    if (!FINDING_ID.test(f?.id ?? "")) errors.push(`findings[${i}].id must look like X-001`)
    else if (ids.has(f.id)) errors.push(`duplicate finding id: ${f.id}`)
    else ids.add(f.id)
    if (!["critical", "high", "medium", "low"].includes(f?.severity)) errors.push(`findings[${i}].severity is not a severity`)
    if (!isStr(f?.title)) errors.push(`findings[${i}].title must be a non-empty string`)
  }
  for (const [i, c] of (review.claims ?? []).entries()) {
    if (!isStr(c?.target)) errors.push(`claims[${i}].target must name an AC or INV id`)
    if (!VERDICTS.has(c?.verdict)) errors.push(`claims[${i}].verdict must be one of ${[...VERDICTS].join(", ")}`)
    if (!Array.isArray(c?.citations) || c.citations.length === 0)
      errors.push(`claims[${i}] (${c?.target ?? "?"}) cites nothing — a claim with no citation is an opinion`)
  }
  return { ok: errors.length === 0, errors }
}

// An exception belongs to the exact review, specification and candidate that were accepted.
// A repeated title is not evidence that a later objection has the same scope.
export const reviewDigest = (review) => crypto.createHash("sha256").update(JSON.stringify(review)).digest("hex")

// The gate. Everything it decides is a fact about the review, the spec and the tree.
export function gateX({ review, compiled, tree, changed = [], implementer, acceptances = [], readLines }) {
  if (!changed.length) return { status: "NOT_EVALUATED", reasons: ["empty diff — nothing to review"] }
  if (!review) return { status: "NOT_EVALUATED", reasons: ["no cross-model review recorded — run `gatectl review`"] }

  const shape = validateReview(review)
  if (!shape.ok) return { status: "NOT_EVALUATED", reasons: shape.errors }

  if (review.tree !== tree)
    return { status: "NOT_EVALUATED",
             reasons: [`the review covers tree ${review.tree.slice(0, 8)}…, the working state is ${tree.slice(0, 8)}… — re-run \`gatectl review\``] }
  if (compiled?.digest && review.spec_digest !== compiled.digest)
    return { status: "NOT_EVALUATED", reasons: ["the review was produced against a different version of the spec"] }
  // The invariant is NOT "the reviewer differs from the spec critic". Those two look at different
  // artifacts at different times — the spec before any code, the diff after — and the same
  // outside model doing both is fine, arguably better: one adversary who knows the spec it
  // argued with. The invariant that matters is that the reviewer is not the model that WROTE
  // the code, because that is marking your own homework.
  if (review.model && implementer && review.model.toLowerCase().includes(implementer.toLowerCase()))
    return { status: "NOT_EVALUATED",
             reasons: [`the diff was reviewed by ${review.model}, and policy names ${implementer} as the implementer — a model does not review its own work`] }

  const reasons = []

  // Coverage: every promise and every invariant must be accounted for. This replaces "did you
  // find anything" with "did you look at everything", which is the question that cannot be
  // satisfied by writing nothing.
  const claimed = new Map((review.claims ?? []).map((c) => [c.target, c]))
  const targets = [
    ...(compiled?.acceptance_criteria ?? []).map((ac) => ac.id),
    ...(compiled?.invariants ?? []).map((inv) => inv.id),
  ]
  for (const id of targets) if (!claimed.has(id)) reasons.push(`${id} is not addressed by the review`)
  for (const [target] of claimed) if (!targets.includes(target)) reasons.push(`the review addresses ${target}, which this spec does not contain`)

  // Citations: real code, at the lines claimed. A model that did not look cannot produce these.
  let citationsInDiff = 0
  const verified = []
  for (const claim of review.claims ?? []) {
    for (const citation of claim.citations ?? []) {
      const r = verifyCitation(citation, readLines)
      if (!r.ok) { reasons.push(`${claim.target}: ${r.reason}`); continue }
      verified.push({ target: claim.target, ...r.verified })
      if (changed.includes(citation.file)) citationsInDiff += 1
    }
  }
  if (citationsInDiff === 0)
    reasons.push("no citation in this review points at a file the diff touches — the review is not about this change")

  // A criterion the reviewer could not confirm is not a green criterion — unless somebody has
  // said in writing why it ships anyway.
  //
  // Acceptance used to reach findings only, and reviewers put the same objection either way: as
  // a finding one day and as `AC-07: not_implemented` the next. The second form was unanswerable
  // — the gate stood until the code changed, even when the honest answer was a decision about
  // scope. A protocol whose escape hatch depends on how a model phrased its objection is a
  // protocol that blocks by accident.
  //
  // The acceptance is bound to the exact spec, candidate tree and review, so rewording the criterion
  // makes it a different criterion and the decision has to be taken again.
  const currentAcceptances = acceptances.filter((a) =>
    a.digest === review.spec_digest && a.tree === tree && a.review_digest === reviewDigest(review) && isStr(a.reason))
  const acceptedCriteria = new Map(
    currentAcceptances
      .filter((a) => a.criterion && (!compiled?.digest || a.digest === compiled.digest))
      .map((a) => [a.criterion, a]),
  )
  const acceptedHereCriteria = []
  for (const claim of review.claims ?? []) {
    if (claim.verdict === "implemented" || !targets.includes(claim.target)) continue
    const accepted = acceptedCriteria.get(claim.target)
    if (!accepted) {
      reasons.push(`${claim.target}: the reviewer says "${claim.verdict}"`)
      continue
    }
    acceptedHereCriteria.push(`accepted in writing: ${claim.target} "${claim.verdict}" — ${accepted.reason}`)
  }

  if (reasons.length) return { status: "NOT_EVALUATED", reasons, verified }

  // Findings. Unresolved severe ones fail; an accepted one must have been accepted in writing,
  // against this exact finding, and the acceptance lives in the signed ledger where it can be
  // read back later by whoever wonders why a known problem shipped.
  // Matched on the id AND the title, because ids are handed out per review: `X-001` in one round
  // is a different objection from `X-001` in the next, and an acceptance that carried over by id
  // alone would silently clear a finding nobody ever read.
  // An entry written before titles were recorded carries none, and matching it by id alone is
  // what it meant when it was written. Anything with a title is held to it.
  const byFinding = currentAcceptances.filter((a) => a.finding)
  const isAccepted = (f) =>
    byFinding.some((a) => a.finding === f.id && a.title === f.title)
  const open = (review.findings ?? []).filter((f) => SEVERE.has(f.severity) && !isAccepted(f))
  if (open.length)
    return { status: "FAIL", verified,
             reasons: [`unresolved critical/high findings: ${open.length}`,
                       ...open.map((f) => `  ${f.id} ${f.severity}: ${f.title}`),
                       "fix them and re-run `gatectl review`, or accept one in writing: gatectl review accept <id> --reason \"…\""] }

  const acceptedHere = (review.findings ?? []).filter((f) => SEVERE.has(f.severity) && isAccepted(f))
  return {
    status: "PASS", verified,
    reasons: [
      ...acceptedHere.map((f) => `accepted in writing: ${f.id} ${f.severity} — ${f.title}`),
      ...acceptedHereCriteria,
    ],
    coverage: { targets: targets.length, citations: verified.length, in_diff: citationsInDiff },
  }
}

// A follow-up may resolve or downgrade a severe finding, but must explain that decision.
export function followUpErrors(prior, review) {
  return (prior.findings ?? []).filter(f => SEVERE.has(f.severity) &&
    !(review.findings ?? []).some(n => n.id === f.id && SEVERE.has(n.severity)))
    .filter(f => !(review.resolved_findings ?? []).some(r => r.id === f.id && isStr(r.reason)))
    .map(f => `${f.id}: severe finding removed or downgraded without a resolution reason`)
}
