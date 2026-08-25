// src/core/memory-page.mjs — renders a feature's delivery record as one wiki page.
// Pure by contract: no I/O of any kind lives here, and test/memory-boundary.test.mjs fails if
// it ever grows some. The adapter transports what this returns; it does not decide the content.

// The order gate ceremony actually runs in, so a reader scans the table top-to-bottom as the
// protocol happened. Any gate not named here (a future one) is appended in first-seen order.
const GATE_ORDER = ["L", "R", "Gfast", "Gfull", "X"]

const bullets = (items, empty) =>
  items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `_${empty}_`

// The same rule gate C applies: only the newest entry per gate counts. An older entry is
// history, never a verdict — rendering both would show a feature as passed and failed at once.
function latestPerGate(results) {
  const latest = new Map()
  for (const r of results ?? []) latest.set(r.gate, r)
  const seen = [...latest.keys()]
  const ordered = [...GATE_ORDER.filter((g) => latest.has(g)),
                   ...seen.filter((g) => !GATE_ORDER.includes(g))]
  return ordered.map((g) => latest.get(g))
}

function gateTable(results) {
  const rows = latestPerGate(results)
  if (rows.length === 0) return "_no gate results recorded_"
  return ["| gate | status | at |", "| --- | --- | --- |",
          ...rows.map((r) => `| ${r.gate} | ${r.status} | ${r.at ?? "unknown"} |`)].join("\n")
}

function findingList(critique) {
  const findings = critique?.findings ?? []
  if (findings.length === 0) return "_no critique recorded_"
  return findings
    .map((f) => `- [${f.severity}] ${f.title ?? "(untitled)"} — ${f.resolved ? "RESOLVED" : "UNRESOLVED"}`)
    .join("\n")
}

/** Stable per slug: re-exporting a feature overwrites its page instead of accumulating copies. */
export const pageRef = (slug) => `gatectl/${slug}.md`

// ── The index page ──────────────────────────────────────────────────────────
//
// Recall cannot use the service's own search. Both `/wiki/search` and `/wiki/page/ls` return
// empty for any wiki whose status is not `ready`, and `ready` arrives only after an LLM ingest
// run — so on a wiki gatectl has merely written to, neither can find anything. `/wiki/page/read`
// carries no such gate: it reads from disk by ref.
//
// So gatectl keeps its own index: one line per exported feature, written in the same atomic batch
// as the feature's page. Recall reads it by ref, ranks locally, and reads the winners by ref.
// Nothing in the path depends on an LLM having run, and matching stays a deterministic function
// of text gatectl itself wrote — the same property the gates are built on.
//
// `index` is a forbidden ref at the wiki root only, so the name is namespaced under `gatectl/`.
export const INDEX_REF = "gatectl/_index.md"

const FIELD = " | "

export function renderIndex(entries) {
  const rows = [...entries]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    // The intent is last, so a separator occurring inside it cannot shift any other field.
    .map((e) => `- ${e.slug}${FIELD}${e.tier}${FIELD}${e.intent.replace(/\r?\n/g, " ").trim()}`)
  return `# gatectl delivery index\n\nOne line per feature gatectl has exported. Written by \`gatectl export\`.\n\n${rows.join("\n")}\n`
}

export function parseIndex(text) {
  return (text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const parts = l.slice(2).split(FIELD)
      if (parts.length < 3) return null
      // Rejoin the tail: only the first two separators delimit fields.
      return { slug: parts[0].trim(), tier: parts[1].trim(), intent: parts.slice(2).join(FIELD).trim() }
    })
    .filter(Boolean)
}

/** Last write wins for a slug. A concurrent export can lose one line; the next repairs it. */
export const mergeEntry = (entries, entry) =>
  [...entries.filter((e) => e.slug !== entry.slug), entry]

// Deliberately crude: lowercase word overlap, no stemming, no scoring model. It only has to
// pick a few plausibly related records for a critic to read — and being dumb keeps it
// inspectable and identical on every machine, which a BM25 index on someone else's server is
// not. Terms under 4 characters are dropped: "the", "add", "api" match everything.
const terms = (s) => new Set((s ?? "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])

export function rankEntries(entries, query, limit = 3) {
  const q = terms(query)
  return entries
    .map((e, i) => ({ e, i, score: [...terms(`${e.slug} ${e.intent}`)].filter((t) => q.has(t)).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i) // stable: original order breaks ties
    .slice(0, limit)
    .map((r) => r.e)
}

export function renderPage({ slug, tier, spec, digest, results, critique, at }) {
  return [
    `# ${slug}`,
    "",
    `- tier: ${tier} (derived from allowed paths, never chosen by hand)`,
    `- state: ${spec.state ?? "unknown"}`,
    `- mvp_ref: ${spec.mvpRef ?? "none"}`,
    `- spec digest: ${(digest ?? "").slice(0, 12)}`,
    `- exported: ${at}`,
    "",
    "## Intent",
    "",
    spec.intent || "_none stated_",
    "",
    "## Invariants",
    "",
    bullets(spec.invariants ?? [], "none stated"),
    "",
    "## Acceptance criteria",
    "",
    bullets(spec.acceptanceCriteria ?? [], "none stated"),
    "",
    "## Allowed paths",
    "",
    bullets(spec.allowedPaths ?? [], "none stated"),
    "",
    "## Rollback",
    "",
    spec.rollback || "_none stated_",
    "",
    "## Gate outcomes",
    "",
    gateTable(results),
    "",
    "## Critique findings",
    "",
    findingList(critique),
    "",
  ].join("\n")
}
