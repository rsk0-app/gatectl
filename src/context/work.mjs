// src/context/work.mjs — the operations on the work store, and the loop guard.
//
// The guard answers one question before an attempt starts: has this exact thing already been tried
// on these exact inputs? A repeat is refused, not warned about — the point is that a new session
// cannot rediscover a dead end by accident. It is never absolute: `--reason` lets the attempt
// through and keeps the reason next to it, so the record says why the same thing was tried again.
import { WorkError, transaction } from "./store.mjs"
import { fingerprintInputs, inputsKey, freshness } from "./inputs.mjs"

export const BUDGET = 3
export const EXPORT_FORMAT = "gatectl-work-export"
export const EXPORT_VERSION = 1

const now = () => new Date().toISOString()
// Whitespace only: case and punctuation change what a search or command does.
const same = (a, b) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ")
export const ref = (prefix, id) => `${prefix}-${id}`
export function parseRef(value, prefix) {
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(value ?? "")
  if (!m) throw new WorkError("USAGE", `expected an id like ${prefix}-1, got ${JSON.stringify(value ?? null)}`)
  return Number(m[1])
}

function question(db, id) {
  const q = db.prepare("SELECT * FROM questions WHERE id = ?").get(id)
  if (!q) throw new WorkError("UNKNOWN_ID", `${ref("Q", id)} does not exist`)
  return q
}

// Attempts without progress since the last result that made some — in the order results were
// recorded, not the order attempts started: a late progress on an old attempt resets the count.
function noProgress(attempts) {
  let count = 0
  const done = attempts.filter((a) => a.status === "done")
    .sort((x, y) => (x.resolved_at < y.resolved_at ? -1 : x.resolved_at > y.resolved_at ? 1 : x.id - y.id))
  for (const a of done) {
    if (a.outcome === "progress" || a.outcome === "answered") count = 0
    else if (a.outcome === "no_progress") count++
  }
  return count
}

export function ask(db, { work, text, decision, by }) {
  if (!text?.trim()) throw new WorkError("USAGE", "work ask needs the question text")
  const r = db.prepare("INSERT INTO questions (work, text, kind, status, by, created_at) VALUES (?, ?, ?, 'open', ?, ?)")
    .run(work, text.trim(), decision ? "decision" : "technical", by, now())
  return ref("Q", r.lastInsertRowid)
}

// `treeKey` is computed by the caller before the write lock is taken: an attempt that names no
// inputs is bound to the whole working tree, which takes git to fingerprint.
export function tryAttempt(db, root, { questionRef, hypothesis, action, inputs, reason, by, treeKey }) {
  if (!hypothesis?.trim() || !action?.trim()) throw new WorkError("USAGE", "work try needs --hypothesis and --action")
  // A reason is what lets an attempt past the guard, so it has to say something.
  if (reason !== undefined && !reason?.trim()) throw new WorkError("USAGE", "--reason must state why this attempt is justified")
  reason = reason?.trim()
  const qid = parseRef(questionRef, "Q")
  const recorded = inputs.length ? fingerprintInputs(root, inputs) : []
  const key = inputs.length ? inputsKey(recorded) : `tree:${treeKey()}`
  return transaction(db, () => {
    const q = question(db, qid)
    const prior = db.prepare("SELECT * FROM attempts WHERE question_id = ? ORDER BY id").all(qid)
    if (!reason) {
      if (q.status !== "open")
        throw new WorkError("QUESTION_CLOSED", `${ref("Q", qid)} is ${q.status}; give --reason to investigate it again`, 1)
      const open = prior.find((a) => a.status === "planned")
      if (open)
        throw new WorkError("INTERRUPTED_ATTEMPT", `${ref("A", open.id)} on ${ref("Q", qid)} has no result ("${open.action}"). Record it with \`work result ${ref("A", open.id)}\`, or give --reason to start another`, 1)
      const repeat = prior.find((a) => a.inputs_key === key && (same(a.hypothesis, hypothesis) || same(a.action, action)))
      if (repeat)
        throw new WorkError("REPEAT_ATTEMPT", `same as ${ref("A", repeat.id)} (hypothesis "${repeat.hypothesis}", action "${repeat.action}", outcome ${repeat.outcome ?? "pending"}) on unchanged inputs. Change the hypothesis or the inputs, or give --reason`, 1)
      const spent = noProgress(prior)
      if (spent >= BUDGET)
        throw new WorkError("BUDGET_EXHAUSTED", `${ref("Q", qid)} has ${spent} attempts without progress. Change the hypothesis, ask for an independent review, or report the blocker; --reason overrides`, 1)
    }
    const r = db.prepare(`INSERT INTO attempts (question_id, work, hypothesis, action, inputs, inputs_key, reason, by, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)`)
      .run(qid, q.work, hypothesis.trim(), action.trim(), JSON.stringify(recorded), key, reason ?? null, by, now())
    return ref("A", r.lastInsertRowid)
  })
}

const OUTCOMES = ["progress", "no_progress", "answered", "blocked"]
const KINDS = ["declaration", "fact", "hypothesis", "check"]

export function result(db, root, { attemptRef, outcome, text, conclusion, kind, inputs, remaining, revisit, by }) {
  const aid = parseRef(attemptRef, "A")
  if (!OUTCOMES.includes(outcome)) throw new WorkError("USAGE", `--outcome must be one of ${OUTCOMES.join(", ")}`)
  if (!text?.trim()) throw new WorkError("USAGE", "work result needs --result")
  // A model's conclusion is a hypothesis until someone says what grounds it.
  const k = kind ?? "hypothesis"
  if (!KINDS.includes(k)) throw new WorkError("USAGE", `--kind must be one of ${KINDS.join(", ")}`)
  const own = inputs.length ? fingerprintInputs(root, inputs) : null
  return transaction(db, () => {
    const a = db.prepare("SELECT * FROM attempts WHERE id = ?").get(aid)
    if (!a) throw new WorkError("UNKNOWN_ID", `${ref("A", aid)} does not exist`)
    const at = now()
    const changed = db.prepare(`UPDATE attempts SET status = 'done', outcome = ?, result = ?, remaining = ?, revisit = ?, resolved_at = ?
      WHERE id = ? AND status = 'planned'`).run(outcome, text.trim(), remaining ?? null, revisit ?? null, at, aid).changes
    if (changed !== 1)
      throw new WorkError("ATTEMPT_ALREADY_RESOLVED", `${ref("A", aid)} already has a result; attempts are not rewritten`, 1)
    if (outcome === "answered" || outcome === "blocked")
      db.prepare("UPDATE questions SET status = ?, closed_at = ? WHERE id = ? AND status = 'open'")
        .run(outcome === "answered" ? "answered" : "blocked", at, a.question_id)
    let c = null
    if (conclusion?.trim()) {
      const r = db.prepare("INSERT INTO conclusions (work, question_id, attempt_id, text, kind, by, inputs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(a.work, a.question_id, aid, conclusion.trim(), k, by, own ? JSON.stringify(own) : a.inputs, at)
      c = ref("C", r.lastInsertRowid)
    }
    return { attempt: ref("A", aid), conclusion: c }
  })
}

export function note(db, root, { work, text, kind, inputs, questionRef, by }) {
  if (!text?.trim()) throw new WorkError("USAGE", "work note needs the statement text")
  const k = kind ?? "hypothesis"
  if (!KINDS.includes(k)) throw new WorkError("USAGE", `--kind must be one of ${KINDS.join(", ")}`)
  const recorded = fingerprintInputs(root, inputs)
  const qid = questionRef ? parseRef(questionRef, "Q") : null
  return transaction(db, () => {
    // A note about a question belongs to that question's work, whatever --work said.
    const owner = qid ? question(db, qid).work : work
    const r = db.prepare("INSERT INTO conclusions (work, question_id, attempt_id, text, kind, by, inputs, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)")
      .run(owner, qid, text.trim(), k, by, JSON.stringify(recorded), now())
    return ref("C", r.lastInsertRowid)
  })
}

// An answer closes the question and is recorded as a declaration by whoever gave it.
export function answer(db, root, { questionRef, text, by }) {
  if (!text?.trim()) throw new WorkError("USAGE", "work answer needs the answer text")
  const qid = parseRef(questionRef, "Q")
  return transaction(db, () => {
    const q = question(db, qid)
    if (q.status !== "open") throw new WorkError("QUESTION_CLOSED", `${ref("Q", qid)} is already ${q.status}`, 1)
    const at = now()
    db.prepare("UPDATE questions SET status = 'answered', closed_at = ? WHERE id = ?").run(at, qid)
    const r = db.prepare("INSERT INTO conclusions (work, question_id, attempt_id, text, kind, by, inputs, created_at) VALUES (?, ?, NULL, ?, 'declaration', ?, '[]', ?)")
      .run(q.work, qid, text.trim(), by, at)
    return ref("C", r.lastInsertRowid)
  })
}

export function checkpoint(db, { work, goal, doneWhen, next, summary, by }) {
  if (!next?.trim()) throw new WorkError("USAGE", "work checkpoint needs --next: the next concrete action")
  return transaction(db, () => {
    // Goal and completion condition carry forward until someone changes them.
    const last = db.prepare("SELECT * FROM checkpoints WHERE work = ? ORDER BY id DESC LIMIT 1").get(work)
    const r = db.prepare("INSERT INTO checkpoints (work, goal, done_when, next_action, summary, by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(work, goal?.trim() || last?.goal || null, doneWhen?.trim() || last?.done_when || null, next.trim(), summary ?? null, by, now())
    return ref("K", r.lastInsertRowid)
  })
}

// The brief for one piece of work. `specGoal` is the fallback when no checkpoint names a goal.
export function brief(db, root, { work, specGoal }) {
  const k = db.prepare("SELECT * FROM checkpoints WHERE work = ? ORDER BY id DESC LIMIT 1").get(work)
  const questions = db.prepare("SELECT * FROM questions WHERE work = ? ORDER BY id").all(work)
  const attempts = db.prepare("SELECT * FROM attempts WHERE work = ? ORDER BY id").all(work)
  const byQuestion = new Map()
  for (const a of attempts) byQuestion.set(a.question_id, [...(byQuestion.get(a.question_id) ?? []), a])
  const describe = (q) => {
    const list = byQuestion.get(q.id) ?? []
    return { id: ref("Q", q.id), text: q.text, attempts: list.length, no_progress: noProgress(list) }
  }
  const open = questions.filter((q) => q.status === "open")
  const conclusions = db.prepare("SELECT * FROM conclusions WHERE work = ? ORDER BY id").all(work).map((c) => {
    const inputs = JSON.parse(c.inputs)
    return {
      id: ref("C", c.id), text: c.text, kind: c.kind, by: c.by,
      question: c.question_id ? ref("Q", c.question_id) : null, attempt: c.attempt_id ? ref("A", c.attempt_id) : null,
      freshness: freshness(root, inputs), inputs: inputs.map((i) => i.path), at: c.created_at,
    }
  })
  const other = db.prepare(`SELECT work, COUNT(*) AS interrupted FROM attempts WHERE work <> ? AND status = 'planned'
    GROUP BY work ORDER BY work`).all(work).map((r) => ({ work: r.work, interrupted: Number(r.interrupted) }))
  return {
    work,
    goal: k?.goal ?? specGoal ?? null,
    goal_source: k?.goal ? "checkpoint" : specGoal ? "spec intent" : null,
    done_when: k?.done_when ?? null,
    next_action: k?.next_action ?? null,
    checkpoint_at: k?.created_at ?? null,
    decisions: open.filter((q) => q.kind === "decision").map(describe),
    interrupted: attempts.filter((a) => a.status === "planned").map((a) => ({
      id: ref("A", a.id), question: ref("Q", a.question_id), hypothesis: a.hypothesis, action: a.action, at: a.created_at })),
    exhausted: open.map(describe).filter((q) => q.no_progress >= BUDGET),
    blocked: questions.filter((q) => q.status === "blocked").map(describe),
    stale: conclusions.filter((c) => c.freshness === "stale"),
    open_questions: open.filter((q) => q.kind === "technical").map(describe),
    conclusions,
    other_work: other,
  }
}

export function emptyBrief(work, specGoal) {
  return { work, goal: specGoal ?? null, goal_source: specGoal ? "spec intent" : null, done_when: null, next_action: null,
    checkpoint_at: null, decisions: [], interrupted: [], exhausted: [], blocked: [], stale: [], open_questions: [],
    conclusions: [], other_work: [] }
}

const TABLES = {
  questions: { id: "int", work: "str", text: "str", kind: ["technical", "decision"], status: ["open", "answered", "blocked"], by: "str?", created_at: "str", closed_at: "str?" },
  attempts: { id: "int", question_id: "int", work: "str", hypothesis: "str", action: "str", inputs: "inputs", inputs_key: "str", reason: "str?", by: "str?", status: ["planned", "done"], outcome: [null, ...OUTCOMES], result: "str?", remaining: "str?", revisit: "str?", created_at: "str", resolved_at: "str?" },
  conclusions: { id: "int", work: "str", question_id: "int?", attempt_id: "int?", text: "str", kind: KINDS, by: "str?", inputs: "inputs", created_at: "str" },
  checkpoints: { id: "int", work: "str", goal: "str?", done_when: "str?", next_action: "str", summary: "str?", by: "str?", created_at: "str" },
}

export function emptyExport() {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, schema_version: 1, exported_at: now(),
    questions: [], attempts: [], conclusions: [], checkpoints: [] }
}

export function exportAll(db) {
  const out = emptyExport()
  for (const table of Object.keys(TABLES)) {
    out[table] = db.prepare(`SELECT ${Object.keys(TABLES[table]).join(", ")} FROM ${table} ORDER BY id`).all().map((row) => {
      const plain = { ...row }
      if ("inputs" in plain) plain.inputs = JSON.parse(plain.inputs)
      return plain
    })
  }
  return out
}

// A recorded input is a normalized path inside the worktree and a fingerprint this code writes.
// An imported `../../etc/passwd` must not become something the brief reads.
const validInput = (x) => x && typeof x.path === "string" && typeof x.fp === "string" && Object.keys(x).length === 2 &&
  /^(sha256:[0-9a-f]{64}|absent|unreadable)$/.test(x.fp) &&
  x.path.length > 0 && !x.path.startsWith("/") && !x.path.includes("\\") && !/^[A-Za-z]:/.test(x.path) &&
  x.path.split("/").every((s) => s && s !== "." && s !== "..")

// Everything is checked before anything is written, and the write is one transaction: a file that
// is wrong in its last record leaves the store exactly as it was.
export function validateExport(data) {
  const bad = (msg) => { throw new WorkError("IMPORT_INVALID", msg) }
  if (data?.format !== EXPORT_FORMAT || data.version !== EXPORT_VERSION) bad(`not a ${EXPORT_FORMAT} v${EXPORT_VERSION} file`)
  const ids = {}
  for (const [table, columns] of Object.entries(TABLES)) {
    if (!Array.isArray(data[table])) bad(`${table} is not a list`)
    ids[table] = new Set()
    data[table].forEach((row, i) => {
      const where = `${table}[${i}]`
      if (!row || typeof row !== "object") bad(`${where} is not an object`)
      const extra = Object.keys(row).filter((k) => !(k in columns))
      if (extra.length) bad(`${where} has unknown field(s) ${extra.join(", ")}`)
      for (const [col, type] of Object.entries(columns)) {
        const v = row[col]
        const ok = Array.isArray(type) ? type.includes(v ?? null)
          : type === "int" ? Number.isInteger(v) && v > 0
          : type === "int?" ? v === null || (Number.isInteger(v) && v > 0)
          : type === "str" ? typeof v === "string"
          : type === "str?" ? v === null || typeof v === "string"
          : Array.isArray(v) && v.every(validInput)
        if (!ok) bad(`${where}.${col} is invalid (${JSON.stringify(v)})`)
      }
      if (ids[table].has(row.id)) bad(`${where} repeats id ${row.id}`)
      ids[table].add(row.id)
    })
  }
  const need = (set, id, what) => { if (id !== null && !set.has(id)) bad(`${what} references missing id ${id}`) }
  const questions = new Map(data.questions.map((q) => [q.id, q]))
  const attempts = new Map(data.attempts.map((a) => [a.id, a]))
  data.attempts.forEach((a, i) => {
    const where = `attempts[${i}]`
    need(ids.questions, a.question_id, `${where}.question_id`)
    if (questions.get(a.question_id).work !== a.work) bad(`${where}.work differs from its question's`)
    const done = a.status === "done"
    if (done !== (a.outcome !== null) || done !== (a.result !== null) || done !== (a.resolved_at !== null))
      bad(`${where} status, outcome, result and resolved_at disagree`)
    // The repeat check compares keys; a key that does not match the fingerprints would hide a repeat.
    // Inputs are stored sorted and unique; any other order would give the same files another key.
    if (a.inputs.some((x, n) => n > 0 && a.inputs[n - 1].path >= x.path)) bad(`${where}.inputs are not sorted and unique`)
    if (a.inputs.length ? a.inputs_key !== inputsKey(a.inputs) : !/^tree:[0-9a-f]{40,64}$/.test(a.inputs_key))
      bad(`${where}.inputs_key does not match its inputs`)
  })
  data.conclusions.forEach((c, i) => {
    const where = `conclusions[${i}]`
    if (c.inputs.some((x, n) => n > 0 && c.inputs[n - 1].path >= x.path)) bad(`${where}.inputs are not sorted and unique`)
    need(ids.questions, c.question_id, `${where}.question_id`)
    need(ids.attempts, c.attempt_id, `${where}.attempt_id`)
    if (c.question_id !== null && questions.get(c.question_id).work !== c.work) bad(`${where}.work differs from its question's`)
    if (c.attempt_id !== null) {
      const a = attempts.get(c.attempt_id)
      if (a.work !== c.work || a.question_id !== c.question_id) bad(`${where} disagrees with its attempt`)
    }
  })
}

export function importAll(db, data) {
  transaction(db, () => {
    for (const table of Object.keys(TABLES)) {
      const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
      if (n) throw new WorkError("STORE_NOT_EMPTY", `the work store already holds ${table}; import only restores into an empty store`, 1)
    }
    for (const [table, columns] of Object.entries(TABLES)) {
      const cols = Object.keys(columns)
      const insert = db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      for (const row of data[table]) insert.run(...cols.map((c) => (c === "inputs" ? JSON.stringify(row[c]) : row[c])))
    }
  })
}
