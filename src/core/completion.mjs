// src/core/completion.mjs — the Completion Authority's rules.
//
// `commit-check` answers a question about a commit: is this change safe to record. This answers
// one about a feature: is what the spec promised actually delivered. They come apart more often
// than they sound like they should — every gate can be green over a feature that quietly dropped
// half its criteria, because gates judge a diff and this judges a set of promises.
//
// The input is the Test Obligations Manifest, not prose: one entry per acceptance criterion, and
// for each, two pieces of evidence that must both exist and both be about the right tree —
//
//   RED   at base + the test changes alone, proving the test could ever fail
//   GREEN at the final tree, proving it passes now
//
// A criterion with only one half is not delivered. RED alone is a test nobody made pass; GREEN
// alone is a test that may never have been able to fail — the assertion that was always true,
// the case that never ran. Requiring both is what makes "done" mean something.
//
// The authority is deterministic: a fixed list of predicates, each of which holds or is reported
// by name, and every one is evaluated — a report that names one problem when there are four
// costs three more rounds of asking. ACCEPT is the absence of failed predicates, never a
// positive opinion that the work is good.
export function decideCompletion({ spec, obligations, red, green, gateC, attestation }) {
  const failed = []
  const fail = (predicate, detail) => failed.push({ predicate, detail })

  if (spec.missingSections?.length) fail("spec_complete", `missing sections: ${spec.missingSections.join(", ")}`)
  if (spec.blockingQuestions?.length) fail("no_open_questions", `${spec.blockingQuestions.length} BLOCKING question(s) still open`)
  if (spec.acceptanceCriteriaWithoutTests?.length)
    fail("every_criterion_has_a_test", `${spec.acceptanceCriteriaWithoutTests.length} acceptance criterion/criteria name no test`)
  if (!obligations?.length)
    fail("every_criterion_has_a_test", "no test obligations — nothing proves this feature does anything")

  // Evidence is indexed by criterion id, which is why the ids have to be stable: evidence about
  // AC-03 must still be about AC-03 after someone inserts a criterion above it.
  const redBy = new Map((red?.criteria ?? []).map((c) => [c.criterion, c]))
  const greenBy = new Map((green?.criteria ?? []).map((c) => [c.criterion, c]))

  if (!red) fail("red_proven", "gate R never ran for this feature")
  else if (!red.replay) fail("red_proven", "gate R judged a working tree, not a replay — re-run it with --base <sha> so the RED can be reproduced")
  else if (red.digest !== spec.digest) fail("red_proven", "the RED evidence is for an older spec")

  if (!green) fail("green_proven", "no GREEN evidence — run `gatectl green` on the final tree")
  else if (green.tree !== spec.tree) fail("green_proven", "the GREEN evidence is for a different tree than the one in front of us")
  else if (green.digest !== spec.digest) fail("green_proven", "the GREEN evidence is for an older spec")

  for (const o of obligations ?? []) {
    const label = o.selector ? `${o.file}::"${o.selector}"` : o.file
    const r = redBy.get(o.criterion)
    const g = greenBy.get(o.criterion)
    if (!r) fail("red_proven", `${o.criterion} (${label}) has no RED evidence`)
    else if (!r.red?.ok) fail("red_proven", `${o.criterion} (${label}) was never RED (${r.red?.classification ?? "no result"})`)
    if (!g) fail("green_proven", `${o.criterion} (${label}) has no GREEN evidence`)
    else if (!g.green?.ok) fail("green_proven", `${o.criterion} (${label}) does not pass on the final tree (${g.green?.classification ?? "no result"})`)
  }

  if (gateC?.status !== "PASS") fail("commit_check_green", `gate C is ${gateC?.status ?? "unknown"}`)
  if (!attestation?.ok) fail("attested_for_this_tree", attestation?.detail ?? "no attestation for the current tree")

  return { decision: failed.length ? "REJECT" : "ACCEPT", failed_predicates: failed }
}
