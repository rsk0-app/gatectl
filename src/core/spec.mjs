// src/core/spec.mjs — the spec is the contract; parsing failures must be loud and named.
const REQUIRED = ["intent", "invariants", "acceptance_criteria", "allowed_paths", "rollback"]

function sections(text) {
  const out = {}
  const parts = text.split(/^##\s+/m).slice(1)
  for (const part of parts) {
    const nl = part.indexOf("\n")
    const name = part.slice(0, nl).trim().toLowerCase().replace(/\s+/g, "_")
    out[name] = part.slice(nl + 1).trim()
  }
  return out
}

const listItems = (body) =>
  (body ?? "").split(/\r?\n/).filter((l) => l.trim().startsWith("- ")).map((l) => l.trim().slice(2).trim())

export function parseSpec(text) {
  const sec = sections(text)
  const state = /^state:\s*([A-Z_]+)/m.exec(text)?.[1] ?? null
  const mvpRef = /^mvp_ref:\s*(\S+)/m.exec(text)?.[1] ?? null
  const intent = sec.intent ?? ""
  const invariants = listItems(sec.invariants)
  const acceptanceCriteria = listItems(sec.acceptance_criteria)
  const allowedPaths = listItems(sec.allowed_paths).map((s) => s.replace(/^`|`$/g, ""))
  const rollback = sec.rollback ?? ""

  // #5: an acceptance criterion may name a file, or a file and the exact case inside it:
  //
  //     - AC3 rejects expired tokens — required: test/auth.test.ts::"rejects an expired token"
  //
  // The file alone proves only that the file went red, which a syntax error, a missing
  // dependency or an unrelated case in the same file also achieve. A selector lets gate R
  // confirm the case the criterion is actually about. Both forms are valid: a selector is a
  // sharper claim, not a required one.
  //
  // Commas separate entries, but not inside a quoted selector — "rejects a, b and c" is one.
  const requiredTests = []
  const testObligations = []
  const acceptanceCriteriaWithoutTests = []
  for (const ac of acceptanceCriteria) {
    const m = /—\s*required:\s*(.+)$/.exec(ac)
    if (!m) { acceptanceCriteriaWithoutTests.push(ac); continue }
    const id = /^([A-Za-z]+[-_]?\d+)/.exec(ac)?.[1] ?? null
    for (const raw of m[1].match(/(?:"[^"]*"|'[^']*'|[^,])+/g) ?? []) {
      const entry = raw.trim()
      if (!entry) continue
      const sep = entry.indexOf("::")
      const file = (sep === -1 ? entry : entry.slice(0, sep)).trim().replace(/^`|`$/g, "")
      const selector = sep === -1 ? null : entry.slice(sep + 2).trim().replace(/^["']|["']$/g, "")
      if (!requiredTests.includes(file)) requiredTests.push(file)
      testObligations.push({ ac: id, file, selector: selector || null })
    }
  }

  const blockingQuestions = [...text.matchAll(/^BLOCKING:\s*(.+)$/gm)].map((m) => m[1].trim())

  const missingSections = REQUIRED.filter((name) => {
    const v = { intent, invariants, acceptance_criteria: acceptanceCriteria, allowed_paths: allowedPaths, rollback }[name]
    return Array.isArray(v) ? v.length === 0 : !v
  })
  if (!mvpRef) missingSections.push("mvp_ref")

  return { state, mvpRef, intent, invariants, acceptanceCriteria, requiredTests, testObligations,
           acceptanceCriteriaWithoutTests, allowedPaths, rollback, blockingQuestions, missingSections }
}
