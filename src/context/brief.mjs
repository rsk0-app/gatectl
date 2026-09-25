// src/context/brief.mjs — the brief as text, in the order a returning agent (or the owner) needs it.
//
// When space is short, the goal and the next action survive and everything else is cut from the
// bottom, with a line that says so: a brief that silently drops half of what is known reads as
// though nothing else was known.
const MARKER_ROOM = 100

export function briefLines(b) {
  const lines = [`Work: ${b.work}`]
  lines.push(b.goal ? `Goal: ${b.goal}${b.goal_source === "spec intent" ? " (from the spec intent; no checkpoint names a goal)" : ""}` : "Goal: not recorded — `gatectl work checkpoint --goal ...`")
  if (b.done_when) lines.push(`Done when: ${b.done_when}`)
  lines.push(b.next_action ? `Next: ${b.next_action}` : "Next: not recorded — `gatectl work checkpoint --next ...`")
  const section = (title, items, render) => {
    if (!items.length) return
    lines.push(title)
    for (const item of items) lines.push(`  - ${render(item)}`)
  }
  const progress = (q) => q.attempts ? ` (${q.attempts} attempt(s), ${q.no_progress} without progress)` : ""
  section("Decisions needed from the owner:", b.decisions, (q) => `${q.id} ${q.text}`)
  section("Interrupted attempts (record the result, or state why another is started):", b.interrupted,
    (a) => `${a.id} on ${a.question}: ${a.hypothesis} — ${a.action}`)
  section("Exhausted questions (change the hypothesis, ask for an independent review, or report the blocker):", b.exhausted,
    (q) => `${q.id} ${q.text}${progress(q)}`)
  section("Blocked:", b.blocked, (q) => `${q.id} ${q.text}`)
  // Where a conclusion came from travels with it: kind, author, the attempt or question behind it,
  // and the files it was checked against.
  const source = (c) => {
    const from = [c.attempt, c.question].filter(Boolean).join(" on ")
    return [`${c.kind}, by ${c.by ?? "unknown"}, ${c.freshness}`, from && `from ${from}`, c.inputs.length && `inputs: ${c.inputs.join(", ")}`]
      .filter(Boolean).join("; ")
  }
  section("Stale conclusions (inputs changed — recheck before relying on them):", b.stale, (c) => `${c.id} ${c.text} [${source(c)}]`)
  section("Open questions:", b.open_questions, (q) => `${q.id} ${q.text}${progress(q)}`)
  section("Recorded conclusions — context, not proof:", b.conclusions.filter((c) => c.freshness !== "stale"),
    (c) => `${c.id} ${c.text} [${source(c)}]`)
  if (b.other_work.length)
    lines.push(`Other work with interrupted attempts: ${b.other_work.map((w) => `${w.work} (${w.interrupted})`).join(", ")}`)
  return lines
}

// Work, goal, done-when and next always appear; each is shortened to its share of the space first,
// so a long goal cannot push the next action out.
const HEAD = 4
export function renderBrief(b, maxChars = Infinity) {
  const lines = briefLines(b)
  const all = lines.join("\n")
  if (all.length <= maxChars) return all
  const budget = Math.max(0, maxChars - MARKER_ROOM)
  const head = lines.filter((l) => /^(Work|Goal|Done when|Next): /.test(l)).slice(0, HEAD)
  const share = Math.max(40, Math.floor(budget / head.length) - 1)
  const kept = head.map((l) => (l.length > share ? l.slice(0, share - 1) + "…" : l))
  let used = kept.join("\n").length
  const rest = lines.filter((l) => !head.includes(l))
  let taken = 0
  for (const line of rest) {
    if (used + 1 + line.length > budget) break
    kept.push(line)
    used += 1 + line.length
    taken++
  }
  const dropped = rest.length - taken
  return `${kept.join("\n")}\n… truncated: ${dropped} more line(s) — run \`gatectl work brief\` for the full view`.slice(0, maxChars)
}
