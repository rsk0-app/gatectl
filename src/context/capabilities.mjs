// src/context/capabilities.mjs — the readiness map: what was agreed, what gatectl accepted, which
// tests exist, and what is proven on the code as it is now.
//
// Everything here is derived from records gatectl already keeps — MVP.yaml, the specs, their
// locks, the signed ledgers and completion records, the signed check receipts — and the map claims
// no more than they support. In particular it never says "implemented": nothing records that. A
// feature accepted at an earlier tree or an earlier spec revision is shown as exactly that, and a
// criterion passes "on this version" only with a signed receipt for this very tree.
//
// Context, never evidence: no gate reads this module (test/capabilities.test.mjs).
import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"
import { compileSpec } from "../core/spec-compile.mjs"
import { parseSpec } from "../core/spec.mjs"
import { specDigest, latestLock } from "../core/lock.mjs"
import { readLedger } from "../core/ledger.mjs"
import { ledgerFile, attestationFile, loadKey } from "../core/authority.mjs"
import { verifySignature } from "../core/attest.mjs"
import { treeDigest, indexDrift } from "../core/target.mjs"
import { classifyFailure } from "../core/gates.mjs"
import { receiptReader, cachedRunner } from "../core/check-cache.mjs"

// Worst first: a criterion takes the worst state among its obligations.
const ORDER = ["missing", "fail", "no test ran", "index differs from working tree", "receipts disabled", "not run on this version", "pass"]
const worst = (states) => states.reduce((a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b))

function readFeature(root, slug) {
  const dir = path.join(root, "docs/specs", slug)
  const yamlPath = path.join(dir, "spec.yaml"), mdPath = path.join(dir, "spec.md")
  // spec.yaml wins; a broken one is reported, never replaced by an older spec.md beside it.
  if (fs.existsSync(yamlPath)) {
    let parsed
    try { parsed = yaml.load(fs.readFileSync(yamlPath, "utf8")) }
    catch (e) { return { slug, error: `spec.yaml is not valid YAML: ${e.message.split("\n")[0]}` } }
    const result = compileSpec(parsed)
    if (!result.ok) return { slug, error: `spec.yaml does not compile: ${result.errors.join("; ")}` }
    const c = result.compiled
    return {
      slug, dir, digest: result.digest, mvp_ref: c.mvp_ref ?? null, intent: String(c.intent ?? "").trim().split("\n")[0],
      criteria: (c.acceptance_criteria ?? []).map((ac) => ({ id: ac.id, statement: ac.statement,
        obligations: result.obligations.filter((o) => o.criterion === ac.id).map((o) => ({ file: o.file, selector: o.selector })) })),
    }
  }
  if (!fs.existsSync(mdPath)) return null
  const text = fs.readFileSync(mdPath, "utf8")
  const s = parseSpec(text)
  const byId = new Map()
  for (const o of s.testObligations) {
    const id = o.ac ?? "AC-?"
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id).push({ file: o.file, selector: o.selector })
  }
  const criteria = [...byId].map(([id, obligations]) => ({ id, statement: s.acceptanceCriteria.find((a) => a.startsWith(id)) ?? id, obligations }))
  s.acceptanceCriteriaWithoutTests.forEach((statement, i) => criteria.push({ id: /^([A-Za-z]+[-_]?\d+)/.exec(statement)?.[1] ?? `untested-${i + 1}`, statement, obligations: [] }))
  return { slug, dir, digest: specDigest(text), mvp_ref: s.mvpRef, intent: String(s.intent).trim().split("\n")[0], criteria }
}

function agreed(f) {
  try {
    const locks = JSON.parse(fs.readFileSync(path.join(f.dir, "spec.lock.json"), "utf8"))
    const last = latestLock(Array.isArray(locks) ? locks : [])
    if (!last) return "not locked"
    return last.digest === f.digest ? "locked" : "locked at an earlier revision"
  } catch { return "not locked" }
}

function acceptance(root, f, key, tree) {
  try { return readAcceptance(root, f, key, tree) }
  catch (e) { return { state: "unreadable", note: `the ledger cannot be read (${e.message.split("\n")[0]})` } }
}

function readAcceptance(root, f, key, tree) {
  const file = ledgerFile(root, f.slug)
  // The ledger has no external anchor; the signed completion record written by every finish is
  // the cross-check that notices removed entries — including the only Complete there was.
  const completionPath = path.join(path.dirname(attestationFile(root, f.slug)), "completion.json")
  const hasCompletion = fs.existsSync(completionPath)
  if (!fs.existsSync(file))
    return hasCompletion ? { state: "unreadable", note: "a completion record exists but the ledger is missing" } : { state: "no record here" }
  if (!key.ok) return { state: "unreadable", note: key.detail }
  const ledger = readLedger(file, key.key)
  if (!ledger.ok) return { state: "unreadable", note: "the ledger's signature chain does not verify" }
  const last = [...ledger.entries].reverse().find((e) => e.gate === "Complete")
  if (!last) return hasCompletion ? { state: "unreadable", note: "a completion record exists but the ledger has no Complete entry" } : { state: "not finished" }
  let note = null
  if (hasCompletion) {
    let completion
    try { completion = JSON.parse(fs.readFileSync(completionPath, "utf8")) } catch { completion = null }
    if (!completion || !verifySignature(completion, key.key)) return { state: "unreadable", note: "the completion record does not verify" }
    // The decision is compared whatever the ledger's age: a legacy PASS left behind by a removed
    // modern FAIL still disagrees with the REJECT the completion record holds.
    if ((last.completion_mac && completion.mac !== last.completion_mac) || (completion.decision === "ACCEPT") !== (last.status === "PASS"))
      return { state: "unreadable", note: "the ledger and the latest completion record disagree" }
    if (!last.completion_mac) note = "not cross-checked: older ledger entry without a completion link"
  } else if (last.completion_mac) return { state: "unreadable", note: "the ledger names a completion record that is missing" }
  else note = "not cross-checked: older ledger without a completion record"
  const at = last.at ?? null
  const base = last.status !== "PASS" ? "rejected"
    : last.digest !== f.digest ? "an earlier revision was accepted"
    : last.tree !== tree ? "accepted at an earlier tree"
    : "accepted"
  // Unverified legacy acceptance is its own state, never counted with cross-checked acceptance.
  return { state: note && base !== "rejected" ? `${base} (not cross-checked)` : base, at, ...(note ? { note } : {}) }
}

export function buildMap(root, policy, mvp) {
  const tree = treeDigest(root)
  const drift = indexDrift(root).length > 0
  const reader = receiptReader(root, policy)
  const key = loadKey(root, { create: false })
  const commands = policy.commands ?? {}
  const current = (o) => {
    if (drift) return "index differs from working tree"
    if (!reader) return "receipts disabled"
    const command = o.selector ? commands.test_case : commands.test_file
    if (!command || command === "none") return "not run on this version"
    const saved = reader(command, o.selector ? { file: o.file, selector: o.selector } : { file: o.file })
    if (!saved) return "not run on this version"
    if (classifyFailure(saved.output ?? "", policy) === "empty") return "no test ran"
    return saved.code === 0 ? "pass" : "fail"
  }

  const specsDir = path.join(root, "docs/specs")
  const slugs = fs.existsSync(specsDir)
    ? fs.readdirSync(specsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []
  const features = []
  for (const slug of slugs) {
    const f = readFeature(root, slug)
    if (!f) continue
    if (f.error) { features.push({ slug, error: f.error, bucket: "unreadable" }); continue }
    const criteria = f.criteria.map((c) => {
      const obligations = c.obligations.map((o) => {
        const file = path.join(root, o.file)
        const present = fs.existsSync(file) && (!o.selector || fs.readFileSync(file, "utf8").includes(o.selector))
        return { file: o.file, selector: o.selector, present, current: present ? current(o) : "missing" }
      })
      return { id: c.id, statement: c.statement, result: obligations.length ? worst(obligations.map((o) => o.current)) : "no test declared", obligations }
    })
    features.push({ slug, intent: f.intent, mvp_ref: f.mvp_ref, agreed: agreed(f), acceptance: acceptance(root, f, key, tree), criteria })
  }

  const goals = (mvp?.mvp_done_when ?? []).filter((g) => g?.id)
  const goalIds = new Set(goals.map((g) => g.id))
  const bucketOf = (f) => f.bucket ?? (goalIds.has(f.mvp_ref) ? `goal:${f.mvp_ref}`
    : f.mvp_ref === "maintenance" ? "maintenance"
    : !f.mvp_ref || /^REPLACE/.test(f.mvp_ref) ? "unset" : `undeclared:${f.mvp_ref}`)
  const of = (bucket) => features.filter((f) => bucketOf(f) === bucket)
  const groups = [
    ...goals.map((g) => ({ kind: "goal", id: g.id, text: g.text ?? "", features: of(`goal:${g.id}`) })),
    { kind: "maintenance", id: "maintenance", text: "maintenance (no product goal)", features: of("maintenance") },
    ...[...new Set(features.map(bucketOf).filter((b) => b.startsWith("undeclared:")))].sort()
      .map((b) => ({ kind: "undeclared", id: b.slice(11), text: "a goal .gatectl/MVP.yaml does not declare", features: of(b) })),
    { kind: "unset", id: "unset", text: "mvp_ref missing or still a template placeholder", features: of("unset") },
    { kind: "unreadable", id: "unreadable", text: "specs gatectl cannot read", features: of("unreadable") },
  ]
  for (const g of groups) {
    if (g.kind === "goal" && !g.features.length) g.note = "no gatectl feature references this goal (code may exist without a spec)"
    const count = (list) => list.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {})
    g.summary = {
      features: g.features.length,
      acceptance: count(g.features.filter((f) => f.acceptance).map((f) => f.acceptance.state)),
      criteria: count(g.features.flatMap((f) => f.criteria ?? []).map((c) => c.result)),
    }
  }
  return { tree, drift, receipts: reader ? "enabled" : "disabled", groups }
}

// Runs what is not yet passing on this version, with reuse bypassed for it, through the same
// cached runner the gates use. Refuses rather than degrade: without receipts nothing it ran could
// be shown afterwards, and it must not create a signing key.
export function runMissing(root, policy, map, { goal = null } = {}) {
  if (!policy.workflow || policy.workflow.cache === false)
    return { code: 2, message: "RECEIPTS_DISABLED: this policy keeps no check receipts (no workflow, or workflow.cache: false), so results could not be shown afterwards" }
  if (!loadKey(root, { create: false }).ok)
    return { code: 2, message: "NO_KEY: no signing key for this repository yet; run any gatectl check first (e.g. gatectl check-related)" }
  if (indexDrift(root).length) return { code: 2, message: "INDEX_DRIFT: the working tree differs from the staged index; stage or stash the difference first" }
  const run = cachedRunner(root, policy, { fresh: true, announce: () => {} })
  const done = new Set()
  let ran = 0
  for (const g of map.groups) {
    if (goal && g.id !== goal) continue
    for (const f of g.features) for (const c of f.criteria ?? []) for (const o of c.obligations) {
      if (!o.present || o.current === "pass") continue
      const command = o.selector ? policy.commands?.test_case : policy.commands?.test_file
      if (!command || command === "none") continue
      const subst = o.selector ? { file: o.file, selector: o.selector } : { file: o.file }
      const id = JSON.stringify([command, subst])
      if (done.has(id)) continue
      done.add(id)
      const r = run(command, subst)
      if (r.code === 2 && /Stage the intended candidate|changed during the check/.test(r.output ?? "")) return { code: 2, message: `INDEX_DRIFT: ${r.output}` }
      ran++
    }
  }
  return { code: 0, message: `ran ${ran} test command(s) on this version; receipts recorded` }
}

export function renderMap(map) {
  const lines = ["Capability map (context, not gate evidence)",
    map.drift ? "Code: the working tree differs from the staged index — no result is claimed for the current version"
      : `Code: tree ${map.tree.slice(0, 12)}… — "on this version" means a signed check receipt for exactly this tree`,
    map.receipts === "disabled" ? "Receipts: this policy keeps none, so no current result can be shown" : "Receipts: enabled", ""]
  const phrase = (obj) => Object.entries(obj).map(([k, v]) => `${v} ${k}`).join(", ") || "none"
  for (const g of map.groups) {
    if (g.kind !== "goal" && !g.features.length) continue
    lines.push(g.kind === "goal" ? `${g.id} — ${g.text}` : g.kind === "undeclared" ? `undeclared goal "${g.id}" — ${g.text}` : `${g.id} — ${g.text}`)
    if (g.note) { lines.push(`  ${g.note}`, ""); continue }
    lines.push(`  ${g.summary.features} feature(s): ${phrase(g.summary.acceptance)}`)
    if (Object.keys(g.summary.criteria).length) lines.push(`  criteria: ${phrase(g.summary.criteria)}`)
    for (const f of g.features) {
      if (f.error) { lines.push(`  - ${f.slug}: ${f.error}`); continue }
      const crit = f.criteria.map((c) => `${c.id} ${c.result}`).join("; ") || "no criteria"
      const acc = f.acceptance.note ? `${f.acceptance.state} — ${f.acceptance.note}` : f.acceptance.state
      lines.push(`  - ${f.slug} [${f.agreed}; ${acc}] ${crit}`)
      // The tests behind anything that needs action; --json lists every obligation.
      for (const c of f.criteria) if (["missing", "fail", "no test ran"].includes(c.result))
        for (const o of c.obligations)
          lines.push(`      ${c.id}: ${o.selector ? `${o.file}::"${o.selector}"` : o.file} — ${o.present ? o.current : "not present in the tree"}`)
    }
    lines.push("")
  }
  lines.push("Acceptance is read from this machine's signed ledgers; the ledger has no external anchor, so a removed")
  lines.push("trailing entry is noticed only through the signed completion record. --json lists every test obligation.")
  return lines.join("\n")
}
