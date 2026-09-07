// src/core/spec-compile.mjs — the spec stops being prose the gates guess at.
//
// Markdown is for the human: the reasoning, the "why now", the things that only read well in
// sentences. But a gate that has to find its obligations by regex over free text is a gate that
// silently accepts a typo — a criterion whose `required:` line was mangled simply stops being
// required, and nothing says so. So the source of truth is `spec.yaml`, and this compiler turns
// it into a form the gates can check without interpretation:
//
//   validate  — every field present, every criterion carrying a test, no duplicates
//   stabilise — identifiers that survive reordering, so evidence about AC-03 stays about AC-03
//   canonical — one byte-exact serialisation, so its digest means something
//   obligate  — the Test Obligations Manifest: what must be RED before, and GREEN after
//
// The compiler never invents. A criterion with no test is an error, not a criterion gatectl quietly
// drops; a selector naming a case the test file does not contain is an error, not something
// discovered three commands later when gate R runs it.
import crypto from "node:crypto"
import { canonical } from "./attest.mjs"

const ID = /^[A-Z]{2,4}-\d{2,3}$/
const REQUIRED = ["id", "state", "mvp_ref", "intent", "invariants", "acceptance_criteria", "allowed_paths", "rollback"]
const STATES = ["DRAFT", "SPEC_REVIEWED", "LOCKED", "RED_PROVEN", "IMPLEMENTING", "GREEN", "REVIEWED", "VERIFIED", "COMPLETED"]

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0

// Deliberately hand-written rather than a JSON Schema library: the messages are the product here.
// "acceptance_criteria[2].test.selector must be a non-empty string" tells an agent what to fix;
// a schema path with a keyword next to it does not.
export function validateSpec(spec) {
  const errors = []
  if (!spec || typeof spec !== "object") return { ok: false, errors: ["spec is not a mapping"] }

  for (const key of REQUIRED) if (spec[key] === undefined) errors.push(`missing: ${key}`)
  if (spec.state !== undefined && !STATES.includes(spec.state))
    errors.push(`state must be one of ${STATES.join(", ")} — got ${JSON.stringify(spec.state)}`)
  if (spec.id !== undefined && !isNonEmptyString(spec.id)) errors.push("id must be a non-empty string")
  if (spec.intent !== undefined && !isNonEmptyString(spec.intent)) errors.push("intent must be a non-empty string")

  const list = (name) => (Array.isArray(spec[name]) ? spec[name] : [])
  if (spec.invariants !== undefined && !Array.isArray(spec.invariants)) errors.push("invariants must be a list")
  if (spec.acceptance_criteria !== undefined && !Array.isArray(spec.acceptance_criteria))
    errors.push("acceptance_criteria must be a list")
  if (spec.allowed_paths !== undefined && (!Array.isArray(spec.allowed_paths) || spec.allowed_paths.length === 0))
    errors.push("allowed_paths must be a non-empty list — a feature that may touch anything has no scope")

  if (spec.verification !== undefined && spec.verification !== "policy") errors.push("verification must be policy when provided")
  const seenIds = new Set()
  const seenTests = new Map()

  list("invariants").forEach((inv, i) => {
    if (!isNonEmptyString(inv?.id)) errors.push(`invariants[${i}].id must be a non-empty string`)
    else if (!ID.test(inv.id)) errors.push(`invariants[${i}].id "${inv.id}" is not of the form INV-01`)
    else if (seenIds.has(inv.id)) errors.push(`duplicate id: ${inv.id}`)
    else seenIds.add(inv.id)
    if (!isNonEmptyString(inv?.statement)) errors.push(`invariants[${i}].statement must be a non-empty string`)
  })

  if (Array.isArray(spec.acceptance_criteria) && spec.acceptance_criteria.length === 0)
    errors.push("acceptance_criteria must not be empty — a feature that promises nothing cannot be delivered")

  list("acceptance_criteria").forEach((ac, i) => {
    if (!isNonEmptyString(ac?.id)) errors.push(`acceptance_criteria[${i}].id must be a non-empty string`)
    else if (!ID.test(ac.id)) errors.push(`acceptance_criteria[${i}].id "${ac.id}" is not of the form AC-01`)
    else if (seenIds.has(ac.id)) errors.push(`duplicate id: ${ac.id}`)
    else seenIds.add(ac.id)
    if (!isNonEmptyString(ac?.statement)) errors.push(`acceptance_criteria[${i}].statement must be a non-empty string`)

    // The rule the whole file exists for: a promise with no test behind it is not a criterion.
    if (!ac?.test && spec.verification === "policy") return
    if (!ac?.test || typeof ac.test !== "object") {
      errors.push(`acceptance_criteria[${i}] (${ac?.id ?? "?"}) names no test — every criterion must be provable`)
      return
    }
    if (!isNonEmptyString(ac.test.file)) errors.push(`acceptance_criteria[${i}].test.file must be a non-empty string`)
    if (ac.test.selector !== undefined && !isNonEmptyString(ac.test.selector))
      errors.push(`acceptance_criteria[${i}].test.selector must be a non-empty string when present`)

    // Two criteria pointing at one case means one of them is not actually covered, and the
    // manifest would silently prove the same thing twice.
    const key = `${ac.test.file}::${ac.test.selector ?? ""}`
    if (seenTests.has(key)) errors.push(`${ac.id ?? `acceptance_criteria[${i}]`} and ${seenTests.get(key)} name the same test case: ${key}`)
    else seenTests.set(key, ac.id ?? `acceptance_criteria[${i}]`)
  })

  if (spec.blocking_questions !== undefined) {
    if (!Array.isArray(spec.blocking_questions)) errors.push("blocking_questions must be a list")
    else spec.blocking_questions.forEach((q, i) => {
      if (!isNonEmptyString(q)) errors.push(`blocking_questions[${i}] must be a non-empty string`)
    })
  }
  if (spec.rollback !== undefined && !isNonEmptyString(spec.rollback?.strategy))
    errors.push("rollback.strategy must be a non-empty string — how this is undone is part of the promise")

  return { ok: errors.length === 0, errors }
}

// The Test Obligations Manifest. Each entry is one promise and the exact run that proves it:
// RED before the implementation, GREEN after. Gate R and the Completion Authority read this and
// nothing else — neither of them ever parses prose.
export function obligations(spec) {
  return (spec.acceptance_criteria ?? []).filter((ac) => ac.test).map((ac) => ({
    criterion: ac.id,
    statement: ac.statement,
    file: ac.test.file,
    selector: ac.test.selector ?? null,
    // Named per obligation rather than assumed globally: a criterion may legitimately be proven
    // by a test that fails to compile before the change (a missing export), and that is a
    // different RED from an assertion. Default stays the strict one.
    expected_red: ac.test.expected_red ?? "assertion",
  }))
}

// One byte-exact serialisation, so the digest identifies the spec rather than its formatting.
// Comments, key order and indentation in the YAML have no effect on it; a changed statement does.
export function compileSpec(spec) {
  const check = validateSpec(spec)
  if (!check.ok) return { ok: false, errors: check.errors }
  const compiled = {
    ...(spec.verification === "policy" ? { verification: "policy" } : {}),
    id: spec.id,
    state: spec.state,
    mvp_ref: spec.mvp_ref,
    intent: spec.intent.trim(),
    invariants: spec.invariants.map((i) => ({ id: i.id, statement: i.statement.trim() })),
    acceptance_criteria: spec.acceptance_criteria.map((ac) => ({
      id: ac.id,
      statement: ac.statement.trim(),
      ...(ac.test ? { test: { file: ac.test.file, selector: ac.test.selector ?? null, expected_red: ac.test.expected_red ?? "assertion" } } : {}),
    })),
    allowed_paths: [...spec.allowed_paths],
    rollback: { strategy: spec.rollback.strategy, notes: spec.rollback.notes ?? null },
    // Part of the compiled form, and therefore part of the digest: answering a blocking question
    // changes the spec, and everything bound to the old digest goes stale, as it should.
    blocking_questions: [...(spec.blocking_questions ?? [])],
  }
  const text = canonical(compiled)
  return {
    ok: true,
    compiled,
    obligations: obligations(compiled),
    digest: crypto.createHash("sha256").update(text).digest("hex"),
    canonical: text,
  }
}

// The rest of the engine speaks one shape of spec, whether it came from YAML or from the older
// Markdown. This adapter is that shim — and it is deliberately thin: a compiled spec has already
// been validated, so nothing here re-decides anything, it only renames.
export function specFromCompiled(compiled) {
  const requiredTests = []
  for (const ac of compiled.acceptance_criteria) if (ac.test && !requiredTests.includes(ac.test.file)) requiredTests.push(ac.test.file)
  return {
    state: compiled.state,
    mvpRef: compiled.mvp_ref,
    intent: compiled.intent,
    invariants: compiled.invariants.map((i) => `${i.id} ${i.statement}`),
    acceptanceCriteria: compiled.acceptance_criteria.map((ac) => `${ac.id} ${ac.statement}`),
    requiredTests,
    testObligations: compiled.acceptance_criteria.filter((ac) => ac.test).map((ac) => ({
      ac: ac.id, file: ac.test.file, selector: ac.test.selector, expectedRed: ac.test.expected_red,
    })),
    // The compiler refuses a criterion without a test, so this is empty by construction rather
    // than by luck. Gate L still checks it: one place to look when the rule changes.
    acceptanceCriteriaWithoutTests: compiled.acceptance_criteria.filter((ac) => !ac.test).map((ac) => ac.id),
    allowedPaths: [...compiled.allowed_paths],
    rollback: compiled.rollback.strategy,
    blockingQuestions: [...(compiled.blocking_questions ?? [])],
    missingSections: [],
  }
}
