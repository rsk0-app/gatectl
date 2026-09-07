// src/core/next.mjs — the state machine, derived rather than declared.
//
// Nothing writes a status. There is no `state: GREEN` an agent can set, because a status an agent
// can write is a status an agent will write the moment it feels done. The state is COMPUTED from
// what actually happened: the spec as compiled, the ledger of gate results, and the tree in front
// of us. Change the spec and the state falls back; edit a test after RED and it falls back again.
//
// The order of the checks below is the protocol, and each one answers the only question an agent
// needs answered: what is the single next thing to do.
const STATES = [
  "NO_FEATURE", "SPEC_INVALID", "BLOCKED", "SPEC_REVIEW", "LOCKED",
  "RED_PROVEN", "IMPLEMENTING", "GREEN", "REVIEWED", "VERIFIED", "COMPLETED",
]

const freshFor = (entry, { digest, tree, tests }) => {
  if (!entry || entry.status !== "PASS") return false
  if (entry.digest !== digest) return false
  if (entry.tree !== undefined && tree !== undefined && entry.treeBound !== false && entry.gate !== "L" && entry.gate !== "R" && entry.tree !== tree) return false
  if (entry.gate === "R" && tests !== undefined && entry.tests !== tests) return false
  return true
}

export function nextStep({ feature, spec, digest, tree, tests, results = [], requires = [], critique, hasImplementation, attested, completion, baseHint, critiqueRequired = requires.includes("L") }) {
  const latest = (gate) => [...results].reverse().find((r) => r.gate === gate) ?? null
  const step = (state, next_command, why, extra = {}) => ({
    state, next_command, why,
    allowed_actions: extra.allowed_actions ?? (next_command ? [next_command.split(" ")[1] ?? next_command] : []),
    blocking_questions: spec?.blockingQuestions ?? [],
    ...extra,
  })

  if (!feature) return step("NO_FEATURE", "gatectl new <slug>", "no feature is active")
  if (feature.compileErrors?.length)
    return step("SPEC_INVALID", "edit docs/specs/" + feature.slug + "/spec.yaml", "the spec does not compile", { errors: feature.compileErrors })
  if (!spec) return step("SPEC_INVALID", `edit docs/specs/${feature.slug}/spec.md`, "there is no readable spec")

  // A blocking question is a decision only a person can make. Everything downstream would be a
  // guess dressed as progress.
  if (spec.blockingQuestions?.length)
    return step("BLOCKED", null, `${spec.blockingQuestions.length} BLOCKING question(s) need a human answer`,
                { allowed_actions: ["answer_blocking_questions"] })

  if (!requires.length || requires.some(g => !["L", "R", "Gfast", "Gfull", "X"].includes(g)))
    return step("BLOCKED", null, "policy has missing or unsupported required gates", { allowed_actions: [] })
  const needsRed = requires.includes("R")
  const severeOpen = (critique?.findings ?? []).filter((f) => ["critical", "high"].includes(f.severity) && !f.resolved)
  if (critiqueRequired && !critique?.findings?.length)
    return step("SPEC_REVIEW", "gatectl critique", "no critique yet — a spec nobody argued with is not reviewed")
  if (requires.includes("L") && severeOpen.length)
    return step("SPEC_REVIEW", `edit docs/specs/${feature.slug}/critique.md`,
                `${severeOpen.length} critical/high finding(s) unresolved — resolve each with a RESOLVED: line`,
                { allowed_actions: ["resolve_findings"] })

  if (requires.includes("L") && !freshFor(latest("L"), { digest }))
    return step("SPEC_REVIEW", "gatectl lock", "the spec is not locked at its current digest")

  const red = latest("R")
  if (needsRed && !freshFor(red, { digest, tests }))
    return step("LOCKED", baseHint ? `gatectl red --base ${baseHint}` : "gatectl red --base <sha>",
                "the required tests have not been proven RED against the base commit")
  if (needsRed && !red.replay)
    return step("LOCKED", baseHint ? `gatectl red --base ${baseHint}` : "gatectl red --base <sha>",
                "gate R judged a working tree — replay it against base so the RED can be reproduced")

  if (!hasImplementation && !["Green", "Gfast", "Gfull"].some(gate => freshFor(latest(gate), { digest, tree })))
    return step(needsRed ? "RED_PROVEN" : "IMPLEMENTING", "implement the change", needsRed ? "RED is proven and nothing implements it yet" : "the task has no implementation yet",
                { allowed_actions: ["implement"] })

  if (needsRed && !freshFor(latest("Green"), { digest, tree }))
    return step("IMPLEMENTING", "gatectl green", "no GREEN evidence for this tree — every criterion must pass here")

  if (requires.includes("Gfast") && !freshFor(latest("Gfast"), { digest, tree }))
    return step("IMPLEMENTING", "gatectl gate fast", "the policy requires a fast gate over this tree")

  if (requires.includes("Gfull") && !freshFor(latest("Gfull"), { digest, tree }))
    return step("GREEN", "gatectl gate full", "the full suite and the diff checks have not run over this tree")

  if (requires.includes("X") && !freshFor(latest("X"), { digest, tree }))
    return step("GREEN", "gatectl review", "this tier requires a cross-model review of the diff, and there is none for this tree",
                { allowed_actions: ["review", "gate x"] })

  // Gate C leaves no ledger entry — it IS the check, and a gate that recorded itself would be
  // its own precondition. What it leaves is the attestation, and that is what says it ran over
  // this exact tree.
  if (!attested)
    return step("REVIEWED", "gatectl commit-check", "the gates are green; bind them to this tree and attest it")

  if (completion !== "ACCEPT")
    return step("VERIFIED", "gatectl complete", "everything is bound; ask whether the feature is actually delivered")

  return step("COMPLETED", null, needsRed ? "every criterion is proven RED then GREEN, and the Completion Authority accepted" : "the declared policy gates passed and completion accepted; no per-criterion RED/GREEN claim",
              { allowed_actions: [] })
}

export { STATES }
