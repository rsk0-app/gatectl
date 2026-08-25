// src/core/gates.mjs — deterministic decisions; an LLM never overrides an exit code.
import { matchesAny } from "./tier.mjs"

const SEVERE = new Set(["critical", "high"])

export function gateL({ spec, critique, tier, policy, mvp }) {
  const reasons = []
  if (spec.missingSections.length) reasons.push(`missing sections: ${spec.missingSections.join(", ")}`)
  if (spec.blockingQuestions.length) reasons.push(`open BLOCKING questions: ${spec.blockingQuestions.length}`)
  if (spec.acceptanceCriteriaWithoutTests.length)
    reasons.push(`acceptance criteria naming no required test: ${spec.acceptanceCriteriaWithoutTests.length}`)
  if (spec.mvpRef && spec.mvpRef !== "maintenance") {
    const known = (mvp?.mvp_done_when ?? []).some((e) => e.id === spec.mvpRef)
    if (!known) reasons.push(`mvp_ref "${spec.mvpRef}" not found in .gatectl/MVP.yaml mvp_done_when`)
  }

  // I5: an absent critic policy block fails closed — every tier requires a critique unless
  // the policy explicitly says otherwise (`critic: { required_for_tiers: [] }`).
  const critiqueRequired = policy.critic === undefined
    ? true
    : (policy.critic.required_for_tiers ?? []).includes(tier)
  const hasCritique = !!critique && Array.isArray(critique.findings) && critique.findings.length > 0
  if (hasCritique) {
    // A provided critique's unresolved severe findings block, regardless of whether this
    // tier requires a critique — a critique that exists and found something is never ignored.
    const open = critique.findings.filter((f) => SEVERE.has(f.severity) && !f.resolved)
    if (open.length) reasons.push(`unresolved critical/high findings: ${open.length}`)
  } else if (critiqueRequired) {
    if (reasons.length)
      return { status: "FAIL", reasons: [...reasons, "critique also absent/empty — not evaluated"] }
    return { status: "NOT_EVALUATED",
             reasons: [...reasons, "critique absent or recorded zero findings — a critique that finds nothing is not approval"] }
  }

  return { status: reasons.length ? "FAIL" : "PASS", reasons }
}

// Order matters and is deliberate. `load` first: a file that could not be loaded is the most
// specific diagnosis, and its output often mentions everything else too. `empty` next: a run
// where the named case never executed proves nothing, whatever else it printed. `assertion`
// last, because it is the only class that means RED.
export function classifyFailure(output, policy) {
  const classes = policy.failure_classes ?? {}
  for (const [name, patterns] of [["load", classes.load ?? []], ["empty", classes.empty ?? []], ["assertion", classes.assertion ?? []]])
    if (patterns.some((p) => new RegExp(p, "im").test(output))) return name
  return "unknown"
}

// #5: gate R proves the required tests are RED for the right reason. "The file exited non-zero"
// is a weaker claim than it looks — a syntax error, a missing dependency, a timeout or an
// unrelated case in the same file all produce it. Two mechanisms narrow it:
//
//   failure_classes  — a non-zero exit is only RED if it looks like an assertion. `load` and
//                      `unknown` are NOT_EVALUATED: a broken harness is not a red test.
//   test obligations — an acceptance criterion may name the case (`file::"selector"`), and then
//                      gate R runs THAT case through the policy's `test_case` command.
//
// The exit-0 path is where a runner will quietly lie to you. `vitest run file -t "no match"`
// exits 0 having run nothing, which naively reads as "this test already passes". So exit 0 is
// classified too: an `empty` result is NOT_EVALUATED, and a selector that exits 0 with no empty
// pattern configured is reported as the ambiguity it is, never as a silent green.
export function gateR({ obligations, run, caseCommand = false }, policy) {
  if (!obligations?.length)
    return { status: "NOT_EVALUATED", reasons: ["spec names no required tests"], perTest: [] }
  const perTest = []
  const failReasons = []
  const neReasons = []
  const canDetectEmpty = (policy.failure_classes?.empty ?? []).length > 0
  for (const o of obligations) {
    const label = o.selector ? `${o.file}::"${o.selector}"` : o.file
    // A named case with no way to run one: running the whole file instead would answer a
    // different question and record it under this criterion's name.
    if (o.selector && !caseCommand) {
      perTest.push({ ...o, verdict: "no-case-command" })
      neReasons.push(`${label}: the spec names a case but policy has no test_case command — running the whole file would prove something else`)
      continue
    }
    const r = run(o)
    const kind = classifyFailure(r.output, policy)
    if (kind === "empty") {
      perTest.push({ ...o, verdict: "empty" })
      neReasons.push(`${label}: the runner executed no matching test — a case that never ran is not RED`)
      continue
    }
    if (r.code === 0) {
      perTest.push({ ...o, verdict: "passes" })
      // With no `empty` patterns configured, exit 0 has two readings and gatectl cannot tell them
      // apart: the case passed, or the runner matched nothing and exited 0 anyway. Both are
      // red here — but saying which is which is the difference between a fixable message and a
      // confusing one, so the ambiguity is named only when it is real.
      const ambiguous = o.selector && !canDetectEmpty
      failReasons.push(ambiguous
        ? `${label} exited 0 — either the case already passes, or the runner matched nothing; policy defines no failure_classes.empty patterns, so gatectl cannot tell which`
        : `${label} already passes — nothing to implement against`)
      continue
    }
    perTest.push({ ...o, verdict: kind })
    if (kind === "load" || kind === "unknown") neReasons.push(`${label}: ${kind} failure is NOT_EVALUATED, never RED`)
  }
  if (failReasons.length) return { status: "FAIL", reasons: [...failReasons, ...neReasons], perTest }
  if (neReasons.length) return { status: "NOT_EVALUATED", reasons: neReasons, perTest }
  return { status: "PASS", reasons: [], perTest }
}

export function diffChecks({ changed, diffText, allowedPaths, specDir, metaClass }) {
  const reasons = []
  const allowed = [...allowedPaths, `${specDir}/**`]
  // I4: the engine's own artifacts (this feature's spec dir, and docs/specs/ACTIVE) are
  // always allowed and never meta-class-flagged — gating must not fail on its own bookkeeping.
  const alwaysAllowed = [`${specDir}/**`, "docs/specs/ACTIVE"]
  for (const p of changed) {
    if (matchesAny(p, alwaysAllowed)) continue
    if (matchesAny(p, metaClass)) { reasons.push(`meta-class file touched: ${p}`); continue }
    if (!matchesAny(p, allowed)) reasons.push(`changed outside allowed_paths: ${p}`)
  }
  const deleted = [...diffText.matchAll(/^diff --git a\/(\S+) b\/\S+\r?\ndeleted file/gm)].map((m) => m[1])
  for (const p of deleted) if (/\.(test|spec)\./.test(p)) reasons.push(`test file deleted: ${p}`)
  let currentFile = null
  for (const line of diffText.split("\n")) {
    const fileMatch = line.match(/^diff --git a\/(\S+) b\//)
    if (fileMatch) currentFile = fileMatch[1]
    if (line.startsWith("+") && currentFile && /\.(test|spec)\./.test(currentFile))
      if (/\b(?:it|describe|test|suite)\s*\.\s*(only|skip)\s*\(/.test(line))
        reasons.push(`added ${line.includes(".only") ? ".only" : ".skip"} in: ${line.trim().slice(0, 80)}`)
  }
  return reasons
}

// `none` is the owner declaring, in writing and in a meta-class file agents never edit, that
// this project has no such step. It is not the same as a command nobody filled in: absent means
// unknown, and unknown must refuse. Conflating them made every plain-JS repo with no bundler and
// no TypeScript unable to reach a green gate at all.
//
// Skips are returned, never swallowed: a green that ran everything and a green that skipped a
// step must not look the same to whoever reads the result.
const DECLARED_ABSENT = "none"

// D1: a red gate must show WHY. The excerpt keeps both ends of a long diagnostic and declares
// the gap, because the two ends carry different halves of the answer: compilers put the first
// failures at the top, test runners put the summary at the bottom. A window over one end only
// throws away whichever half the tool in front of you happens to use.
export function excerpt(text, { head = 12, tail = 12 } = {}) {
  const lines = text.replace(/\s+$/, "").split("\n")
  if (lines.length <= head + tail) return lines.join("\n")
  const omitted = lines.length - head - tail
  return [...lines.slice(0, head), `… ${omitted} more line(s) omitted …`, ...lines.slice(-tail)].join("\n")
}

// Streams are excerpted separately and both are shown. Concatenating them and windowing the
// result is what produced the bug this exists to stop: tsc reports on stdout while node prints
// a ~350-character ExperimentalWarning on stderr, so a 400-character tail window rendered the
// reason as exactly `'.` — a FAIL with an invisible cause. Nothing is filtered: swallowing a
// stream to make output tidy is the same failure mode one level down.
export function diagnostics(r) {
  const parts = []
  const out = (r.stdout ?? "").trim()
  const err = (r.stderr ?? "").trim()
  if (out) parts.push(`stdout:\n${excerpt(out)}`)
  if (err) parts.push(`stderr:\n${excerpt(err)}`)
  // A runner that reports neither stream (a hand-rolled `run` in a test, an older adapter)
  // still has its combined output honoured rather than reported as silent.
  if (!parts.length && (r.output ?? "").trim()) parts.push(excerpt(r.output.trim()))
  return parts.length ? parts.join("\n") : "(no output)"
}

function runSteps(run, steps) {
  const reasons = []
  const skipped = []
  for (const [name, cmd, subst] of steps) {
    if (cmd === DECLARED_ABSENT) { skipped.push(name); continue }
    if (!cmd) return { notEvaluated: `policy has no command for ${name}`, reasons, skipped }
    const r = run(cmd, subst ?? {})
    if (r.code !== 0) reasons.push(`${name} failed (exit ${r.code}):\n${diagnostics(r)}`)
  }
  return { reasons, skipped }
}

export function gateGfast({ run, policy, changed }) {
  // I6: nothing changed — there is nothing to gate, and running commands against no diff
  // would be a meaningless green, not a real one.
  if (changed.length === 0) return { status: "NOT_EVALUATED", reasons: ["empty diff — nothing to gate"] }
  const testFiles = changed.filter((p) => /\.(test|spec)\./.test(p))
  const srcFiles = changed.filter((p) => !testFiles.includes(p))
  const { notEvaluated, reasons, skipped } = runSteps(run, [
    ["typecheck", policy.commands?.typecheck],
    ["related tests", policy.commands?.test_related, { files: [...srcFiles, ...testFiles] }],
  ])
  if (notEvaluated) return { status: "NOT_EVALUATED", reasons: [notEvaluated], skipped }
  return { status: reasons.length ? "FAIL" : "PASS", reasons, skipped }
}

export function gateGfull({ run, policy, changed, diffText, spec, specDir }) {
  // I6: same rationale as Gfast — an empty diff has nothing to gate.
  if (changed.length === 0) return { status: "NOT_EVALUATED", reasons: ["empty diff — nothing to gate"] }
  const { notEvaluated, reasons, skipped } = runSteps(run, [
    ["build", policy.commands?.build],
    ["full suite", policy.commands?.test_all],
  ])
  if (notEvaluated) return { status: "NOT_EVALUATED", reasons: [notEvaluated], skipped }
  reasons.push(...diffChecks({ changed, diffText, allowedPaths: spec.allowedPaths, specDir, metaClass: policy.meta_class ?? [] }))
  return { status: reasons.length ? "FAIL" : "PASS", reasons, skipped }
}

// C1/C5: a gate result binds to the state it actually inspected, not only the spec digest — the
// spec can be untouched while what the gate looked at drifts underneath it. The binding differs
// per gate because the gates run at different points in the protocol: L and R run before the
// implementation exists, G-fast/G-full/X after it. Binding every gate to the whole working tree
// made gate C unsatisfiable for any tier requiring both halves. A gate whose ledger entry lacks
// its binding is stale, never green.
const TREE_BOUND = new Set(["Gfast", "Gfull", "X"])

// `blockers` are preconditions the caller established outside the ledger (today: a tier the
// actual diff escalated past what the spec was locked at). `drift` is the working tree having
// moved away from the index the commit will be built from. Both are FAIL, never NOT_EVALUATED:
// each one is a fact that was successfully determined, and the fact is "no".
export function gateC({ results, requires, digest, tree, tests, drift = [], blockers = [] }) {
  const reasons = [...blockers]
  if (drift.length)
    reasons.push(`working tree has drifted from the index — the gates ran against content this commit will not carry: ${drift.join(", ")}`)
  for (const gate of requires) {
    const latest = [...results].reverse().find((r) => r.gate === gate)
    if (!latest) { reasons.push(`gate ${gate} never ran for this feature`); continue }
    if (typeof latest.digest !== "string") { reasons.push(`gate ${gate} has a malformed ledger entry`); continue }
    if (latest.digest !== digest) { reasons.push(`gate ${gate} is green for a stale digest (${latest.digest.slice(0, 8)}…)`); continue }
    if (TREE_BOUND.has(gate)) {
      if (tree !== undefined && latest.tree !== tree) { reasons.push(`gate ${gate} is green for a stale tree`); continue }
    } else if (gate === "R") {
      // R proved the required tests were RED; it survives the implementation landing, but not
      // those tests being edited, weakened, or deleted afterward.
      if (tests !== undefined && latest.tests !== tests) { reasons.push(`gate ${gate} is green for stale required tests`); continue }
    }
    // L is bound to the spec digest alone — it inspected the spec and nothing else.
    if (latest.status !== "PASS") reasons.push(`gate ${gate} is ${latest.status}`)
  }
  return { status: reasons.length ? "FAIL" : "PASS", reasons }
}
