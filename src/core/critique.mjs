// src/core/critique.mjs — reading and writing the adversarial critique of a specification.
//
// The critique did not converge, and the reason was structural: every round started from nothing.
// The critic got a revised spec and was told to refute, but never what it had raised before or what
// the author answered — so it raised the same objection in new words, round after round, at the
// price of a model call and an author's attention each time. One spec in this engine's own history
// went six rounds with the finding count flat; another returned thirty findings in a round, several
// of them restating a non-goal the spec had named in its own text.
//
// The answer is memory, not a limit: a critique that stops because it ran out of turns has not
// converged, it has been silenced.

/** Everything below this heading is history: answered findings, kept for the record, not re-judged. */
export const ARCHIVE_MARKER = "## Answered in earlier rounds"

// src/core/critique.mjs — a valid critique read as "zero findings" blocked a real lock
// (T-004, 2026-08-18); the parser therefore accepts both shapes a model actually writes.
export function parseCritique(text) {
  // Gate L judges the LIVE section only. Below the marker sit findings the author has already
  // answered; re-judging them would make every past argument block the next lock for ever.
  const at = text.indexOf(ARCHIVE_MARKER)
  if (at !== -1) text = text.slice(0, at)
  const provider = /^-?\s*\*?\*?provider\*?\*?:?\s*`?([\w-]+)`?/im.exec(text)?.[1] ?? null
  const model = /^-?\s*\*?\*?model\*?\*?:?\s*`?([\w.\-]+)`?/im.exec(text)?.[1] ?? null
  const findings = []
  for (const block of text.split(/^#{1,3}\s+/m).slice(1)) {
    const firstLine = block.split("\n")[0]
    const sev =
      /SEVERITY:?\s*\**\s*(critical|high|medium|low)/i.exec(block) ??
      /(?:^|[\s*_(\[])(critical|high|medium|low)(?=[\s*_)\]:—]|$)/i.exec(firstLine)
    if (!sev) continue
    findings.push({
      severity: sev[1].toLowerCase(),
      resolved: /^\s*(?:\*\*)?RESOLVED(?:\*\*)?:/m.test(block),
      title: firstLine.slice(0, 90),
    })
  }
  return { provider, model, findings }
}


/**
 * Split a critique file into the findings of its most recent round.
 *
 * Each finding keeps its whole body, because a title alone cannot tell the next critic whether its
 * objection is a restatement: "authorization can be bypassed" says nothing about which input failed.
 */
export function splitRounds(text) {
  if (!text) return null
  const live = text.indexOf(ARCHIVE_MARKER) === -1 ? text : text.slice(0, text.indexOf(ARCHIVE_MARKER))
  const findings = []
  const parts = live.split(/^(?=#{1,3}\s+)/m)
  for (const block of parts) {
    const head = /^#{1,3}\s+(.*)$/m.exec(block)
    if (!head) continue
    const sev = /SEVERITY:?\s*\**\s*(critical|high|medium|low)/i.exec(block)
    if (!sev) continue
    const answerAt = block.search(/^\s*(?:\*\*)?RESOLVED(?:\*\*)?:/m)
    findings.push({
      title: head[1].trim(),
      severity: sev[1].toLowerCase(),
      // The body ends where the answer begins; the answer ends where the next finding does, which
      // is the end of this block.
      body: (answerAt === -1 ? block.slice(head[0].length) : block.slice(head[0].length, answerAt)).trim(),
      answer: answerAt === -1 ? null : block.slice(answerAt).trim(),
      text: block.trim(),
    })
  }
  return findings.length > 0 ? findings : null
}

/** Quoted line by line, so a body carrying its own `## 1.` or `SEVERITY:` cannot become a finding. */
const quote = (text) => text.split("\n").map((l) => `> ${l}`).join("\n")

// A heading inside a BODY is what lets a finding manufacture a second one: the parser splits on
// headings, so `## 99.` in the middle of a scenario becomes a finding of its own, and the RESOLVED
// line meant for the real finding attaches to the phantom. Escaping happens on the way IN, before
// anything is parsed back, and only below each finding's own heading.
const escapeBodyHeadings = (block) => {
  const lines = block.split("\n")
  return lines
    .map((line, i) => (i > 0 && /^#{1,6}\s/.test(line) ? `\\${line}` : line))
    .join("\n")
}

/** Everything the previous file kept below its own marker, so round three does not drop round one. */
export function priorArchive(text) {
  if (!text) return ""
  const at = text.indexOf(ARCHIVE_MARKER)
  return at === -1 ? "" : text.slice(at + ARCHIVE_MARKER.length).trim()
}

/** The rounds a file has already recorded: their numbers and what each cost. */
export function roundHistory(text) {
  if (!text) return { last: 0, counts: [] }
  const nums = [...text.matchAll(/^- round (\d+)/gm)].map((m) => Number(m[1]))
  // A file written before rounds were recorded carries findings and no metadata. It is still a
  // round that happened: counting it as zero would number its successor 1 and lose the history the
  // author is meant to read.
  if (nums.length === 0 && (splitRounds(text) ?? []).length > 0) return { last: 1, counts: [] }
  const counts = /^- earlier rounds: ([\d, ]+) finding/m.exec(text)?.[1]
    ?.split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n)) ?? []
  return { last: nums.length > 0 ? Math.max(...nums) : 0, counts }
}

/**
 * The file a round writes.
 *
 * ANSWERED findings move below the marker: the author's argument survives, and gate L stops
 * re-judging it. UNANSWERED ones are carried forward into the live section, because archiving them
 * would hand the ratchet a bypass in the other direction — an inconvenient high finding could be
 * walked out of enforcement by running one more round.
 */
export function renderCritiqueFile({ slug, provider, model, prior, newText, round, history, archive }) {
  const answered = (prior ?? []).filter((f) => f.answer)
  const unanswered = (prior ?? []).filter((f) => !f.answer)
  const n = round ?? (prior ? 2 : 1)
  const counts = history && history.length > 0 ? `\n- earlier rounds: ${history.join(", ")} finding(s)` : ""
  const out = [
    `# Critique — ${slug}`,
    "",
    `- provider: ${provider ?? "openai"}`,
    `- model: ${model}`,
    `- round ${n}${counts}`,
    "",
    "Resolve every critical/high finding by appending a RESOLVED: line under it.",
    "",
    "---",
    "",
    // Escaped on the way in, so nothing in a body can pose as a finding when this file is read back.
    (splitRounds(newText) ?? []).length > 0
      ? (splitRounds(newText) ?? []).map((f) => escapeBodyHeadings(f.text)).join("\n\n")
      : newText.trim(),
  ]
  if (unanswered.length > 0) {
    out.push("", "<!-- carried forward: raised in an earlier round and still unanswered -->", "")
    for (const f of unanswered) out.push(escapeBodyHeadings(f.text), "")
  }
  // The archive accumulates: this round's answered findings, then everything earlier rounds had
  // already put below the marker. Dropping the old block would lose round one at round three.
  if (answered.length > 0 || archive) {
    out.push("", ARCHIVE_MARKER, "")
    for (const f of answered) out.push(quote(escapeBodyHeadings(f.text)), "")
    if (archive) out.push(archive, "")
  }
  return out.join("\n") + "\n"
}
