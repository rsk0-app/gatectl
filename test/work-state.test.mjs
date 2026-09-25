// The work store is the memory of HOW the work went — questions, attempts, conclusions, the next
// step — kept so a new session continues instead of starting over, and so a failed attempt is not
// quietly repeated. It is context, never evidence: nothing here may move a gate.
//
// Every case drives the real CLI in a child process. That is deliberate beyond realism: the test
// process itself may run on a Node without node:sqlite, and the CLI's own loading path (lazy
// import, re-exec with --experimental-sqlite) is part of what is being tested.
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { execFileSync, spawn, spawnSync } from "node:child_process"

const BIN = path.resolve("bin/gatectl.mjs")
const SRC = path.resolve("src")

// Flags a helper process needs to open a SQLite file directly (to build a WAL or newer-schema
// store the CLI would never write itself).
const SQLITE_FLAGS = spawnSync(process.execPath, ["-e", "require('node:sqlite')"]).status === 0
  ? [] : ["--experimental-sqlite", "--no-warnings"]
function sqliteScript(code) {
  const r = spawnSync(process.execPath, [...SQLITE_FLAGS, "--input-type=module", "-e", code], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`sqlite helper failed: ${r.stderr}`)
  return r.stdout
}

function makeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gatectl-work-")))
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t")
  fs.mkdirSync(path.join(root, "src"))
  fs.writeFileSync(path.join(root, "src/a.js"), "export const a = 1\n")
  git("add", "."); git("commit", "-qm", "init")
  const state = `${root}-state`
  const baseEnv = { ...process.env, GATECTL_STATE_DIR: state }
  delete baseEnv.GATECTL_WORK_SQLITE
  const cli = (args, { env = {}, target = root } = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args, "--target", target],
      { cwd: target, env: { ...baseEnv, ...env }, encoding: "utf8", timeout: 60000 })
    return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` }
  }
  const cliAsync = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args, "--target", root], { cwd: root, env: baseEnv })
    let out = "", err = ""
    child.stdout.on("data", (d) => { out += d }); child.stderr.on("data", (d) => { err += d })
    child.on("close", (code) => resolve({ code, out, err, all: out + err }))
  })
  const ok = (args, opts) => {
    const r = cli(args, opts)
    expect(r.code, `gatectl ${args.join(" ")}: ${r.all}`).toBe(0)
    return r
  }
  const id = (args, opts) => /\b([QACK]-\d+)\b/.exec(ok(args, opts).out)[1]
  const brief = (extra = [], opts) => JSON.parse(ok(["work", "brief", "--json", ...extra], opts).out)
  const hook = (event = "SessionStart", env = {}) => {
    const r = spawnSync(process.execPath, [BIN, "hook"], { cwd: root, env: { ...baseEnv, ...env }, encoding: "utf8",
      input: JSON.stringify({ hook_event_name: event, cwd: root, session_id: "s-1" }), timeout: 60000 })
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(r.stdout)
  }
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }
  const storeFile = () => ok(["work", "path"]).out.trim()
  return { root, git, cli, cliAsync, ok, id, brief, hook, write, storeFile }
}

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex")
const snapshot = (file) => Object.fromEntries(["", "-wal", "-shm"].filter((s) => fs.existsSync(file + s))
  .map((s) => [s || "db", fs.readFileSync(file + s)]))

// Each case drives many CLI processes (two per command where node:sqlite needs its flag), which
// under a parallel full run takes far longer than vitest's 5 s default.
describe("work state", { timeout: 60000 }, () => {
  it("a new session recovers goal, findings and next action", () => {
    const r = makeRepo()
    r.write("docs/specs/ACTIVE", "feat-a\n")
    r.ok(["work", "checkpoint", "--goal", "Ship login", "--next", "write the failing expiry test", "--done-when", "login test green"])
    const q1 = r.id(["work", "ask", "Why does login fail after an hour?"])
    const a1 = r.id(["work", "try", q1, "--hypothesis", "token expiry off by one", "--action", "read src/a.js", "--input", "src/a.js", "--by", "claude"])
    r.ok(["work", "result", a1, "--outcome", "answered", "--result", "expiry compares with <",
      "--conclusion", "Expiry check uses < instead of <=", "--kind", "fact", "--by", "claude"])
    const q2 = r.id(["work", "ask", "Which identity provider should own sessions?", "--decision"])
    const q3 = r.id(["work", "ask", "Is the cache involved?"])
    // Another piece of work in the same worktree must not leak into this one's goal or next step.
    r.ok(["work", "checkpoint", "--work", "feat-b", "--goal", "Unrelated billing goal", "--next", "unrelated billing step"])
    const qb = r.id(["work", "ask", "Billing question", "--work", "feat-b"])
    r.id(["work", "try", qb, "--hypothesis", "hb", "--action", "ab", "--work", "feat-b"])

    const b = r.brief()
    expect(b.work).toBe("feat-a")
    expect(b.goal).toBe("Ship login")
    expect(b.next_action).toBe("write the failing expiry test")
    expect(b.done_when).toBe("login test green")
    const c = b.conclusions.find((x) => x.text === "Expiry check uses < instead of <=")
    expect(c).toMatchObject({ kind: "fact", by: "claude", attempt: a1, question: q1, freshness: "current" })
    expect(b.open_questions.map((q) => q.id)).toEqual([q3])
    expect(b.decisions.map((q) => q.id)).toEqual([q2])
    expect(b.other_work).toEqual([{ work: "feat-b", interrupted: 1 }])
    expect(JSON.stringify(b)).not.toContain("Unrelated billing")

    fs.mkdirSync(path.join(r.root, ".gatectl"), { recursive: true })
    fs.writeFileSync(path.join(r.root, ".gatectl/policy.yaml"), "version: 1\ntiers: {}\n")
    const context = r.hook("SessionStart").hookSpecificOutput.additionalContext
    expect(context).toContain("gatectl is enabled")
    expect(context).toContain("Ship login")
    expect(context).toContain("write the failing expiry test")
    expect(context).toContain("Expiry check uses < instead of <=")
    expect(context).toContain(`fact, by claude, current; from ${a1} on ${q1}; inputs: src/a.js`)
    expect(context).toContain("Which identity provider should own sessions?")
    expect(context).not.toContain("Unrelated billing")
  })

  it("refuses a repeated attempt on unchanged inputs without a stated reason", () => {
    const r = makeRepo()
    const q = r.id(["work", "ask", "Where is the user id parsed?"])
    const a1 = r.id(["work", "try", q, "--hypothesis", "h1", "--action", "rg UserID src", "--input", "src/a.js"])
    r.ok(["work", "result", a1, "--outcome", "no_progress", "--result", "nothing"])

    const again = r.cli(["work", "try", q, "--hypothesis", "h1", "--action", "rg   UserID src", "--input", "src/a.js"])
    expect(again.code).toBe(1)
    expect(again.all).toContain("REPEAT_ATTEMPT")
    expect(again.all).toContain(a1)
    const sameHypothesis = r.cli(["work", "try", q, "--hypothesis", "h1", "--action", "something else", "--input", "src/a.js"])
    expect(sameHypothesis.code).toBe(1)
    expect(sameHypothesis.all).toContain("REPEAT_ATTEMPT")

    // Case is significant: a case-sensitive search for a different spelling is a different check.
    const a2 = r.id(["work", "try", q, "--hypothesis", "h2", "--action", "rg userid src", "--input", "src/a.js"])
    r.ok(["work", "result", a2, "--outcome", "no_progress", "--result", "nothing"])

    // Changed input: the same attempt is a new experiment.
    r.write("src/a.js", "export const a = 2\n")
    const a3 = r.id(["work", "try", q, "--hypothesis", "h1", "--action", "rg UserID src", "--input", "src/a.js"])
    r.ok(["work", "result", a3, "--outcome", "no_progress", "--result", "nothing"])

    // Three attempts without progress: the budget is spent.
    const blank = r.cli(["work", "try", q, "--hypothesis", "h1", "--action", "rg UserID src", "--input", "src/a.js", "--reason", "   "])
    expect(blank.code).toBe(2)
    expect(blank.all).toContain("--reason")
    const spent = r.cli(["work", "try", q, "--hypothesis", "h4", "--action", "a4", "--input", "src/a.js"])
    expect(spent.code).toBe(1)
    expect(spent.all).toContain("BUDGET_EXHAUSTED")
    expect(r.brief().exhausted.map((x) => x.id)).toEqual([q])

    const a4 = r.id(["work", "try", q, "--hypothesis", "h4", "--action", "a4", "--input", "src/a.js", "--reason", "switching to log inspection"])
    r.ok(["work", "result", a4, "--outcome", "progress", "--result", "found the parser in logs"])
    expect(r.brief().exhausted).toEqual([])
    // Progress reset the count.
    const a5 = r.id(["work", "try", q, "--hypothesis", "h5", "--action", "a5", "--input", "src/a.js"])
    r.ok(["work", "result", a5, "--outcome", "no_progress", "--result", "nothing"])

    // An exact repeat is allowed with a stated reason, and the reason is kept.
    const a6 = r.id(["work", "try", q, "--hypothesis", "h1", "--action", "rg UserID src", "--input", "src/a.js", "--reason", "index rebuilt externally"])
    const exported = JSON.parse(r.ok(["work", "export"]).out)
    const byId = Object.fromEntries(exported.attempts.map((a) => [`A-${a.id}`, a]))
    expect(byId[a4].reason).toBe("switching to log inspection")
    expect(byId[a6].reason).toBe("index rebuilt externally")
    expect(byId[a1].reason).toBeNull()

    // The count follows the order results were recorded: a late progress on an old attempt resets it.
    const q2 = r.id(["work", "ask", "Second question"])
    const b1 = r.id(["work", "try", q2, "--hypothesis", "b1", "--action", "b1"])
    for (const n of [2, 3, 4]) {
      const b = r.id(["work", "try", q2, "--hypothesis", `b${n}`, "--action", `b${n}`, "--reason", "parallel probe"])
      r.ok(["work", "result", b, "--outcome", "no_progress", "--result", "nothing"])
    }
    expect(r.brief().exhausted.map((x) => x.id)).toContain(q2)
    r.ok(["work", "result", b1, "--outcome", "progress", "--result", "the slow probe found it"])
    expect(r.brief().exhausted.map((x) => x.id)).not.toContain(q2)
  })

  it("marks a conclusion stale when its input changes", () => {
    const r = makeRepo()
    r.write("src/b.js", "export const b = 5\n")
    const q = r.id(["work", "ask", "What does a depend on?"])
    const a = r.id(["work", "try", q, "--hypothesis", "h", "--action", "read", "--input", "src/a.js", "--input", "src/b.js"])
    r.ok(["work", "result", a, "--outcome", "answered", "--result", "r", "--conclusion", "a and b are independent", "--kind", "fact"])
    const onB = r.id(["work", "note", "Default b is 5", "--kind", "fact", "--input", "src/b.js"])
    const loose = r.id(["work", "note", "Probably nobody calls b", "--kind", "hypothesis"])
    const fresh = (b) => Object.fromEntries(b.conclusions.map((c) => [c.id, c.freshness]))

    let b = r.brief()
    const both = b.conclusions.find((c) => c.text === "a and b are independent").id
    expect(fresh(b)).toMatchObject({ [both]: "current", [onB]: "current", [loose]: "unknown" })

    r.write("src/a.js", "export const a = 99\n")
    b = r.brief()
    expect(fresh(b)).toMatchObject({ [both]: "stale", [onB]: "current" })
    expect(b.stale.map((c) => c.id)).toContain(both)

    fs.rmSync(path.join(r.root, "src/b.js"))
    expect(fresh(r.brief())).toMatchObject({ [onB]: "stale" })

    // History keeps what the conclusion was based on, not what the file is now.
    const exported = JSON.parse(r.ok(["work", "export"]).out)
    const stored = exported.conclusions.find((c) => `C-${c.id}` === both)
    expect(stored.inputs).toContainEqual({ path: "src/a.js", fp: `sha256:${sha("export const a = 1\n")}` })

    if (process.getuid?.() !== 0) {
      r.write("src/c.js", "secret shape\n")
      fs.chmodSync(path.join(r.root, "src/c.js"), 0o000)
      const locked = r.id(["work", "note", "c looks fine", "--kind", "fact", "--input", "src/c.js"])
      expect(fresh(r.brief())[locked]).toBe("unknown")
      fs.chmodSync(path.join(r.root, "src/c.js"), 0o644)
    }

    // Absent then and now is not a readable input: unknown, not current.
    const missing = r.id(["work", "note", "nothing defines d yet", "--kind", "fact", "--input", "src/d.js"])
    expect(fresh(r.brief())[missing]).toBe("unknown")
    // One unreadable input outweighs another that changed: it cannot be rechecked.
    if (process.getuid?.() !== 0) {
      r.write("src/e.js", "e1\n"); r.write("src/f.js", "f1\n")
      const mixed = r.id(["work", "note", "e and f agree", "--kind", "fact", "--input", "src/e.js", "--input", "src/f.js"])
      r.write("src/e.js", "e2\n")
      fs.chmodSync(path.join(r.root, "src/f.js"), 0o000)
      expect(fresh(r.brief())[mixed]).toBe("unknown")
      fs.chmodSync(path.join(r.root, "src/f.js"), 0o644)
    }

    fs.symlinkSync("/etc/hosts", path.join(r.root, "src/outside"))
    const escape = r.cli(["work", "note", "x", "--input", "src/outside"])
    expect(escape.code).toBe(2)
    expect(escape.all).toContain("INPUT_OUTSIDE_WORKTREE")
    fs.symlinkSync("/nonexistent-gatectl-target/file", path.join(r.root, "src/dangling"))
    const dangling = r.cli(["work", "note", "x", "--input", "src/dangling"])
    expect(dangling.code).toBe(2)
    expect(dangling.all).toContain("INPUT_OUTSIDE_WORKTREE")
    const dir = r.cli(["work", "note", "x", "--input", "src"])
    expect(dir.code).toBe(2)
    expect(dir.all).toContain("INPUT_IS_DIRECTORY")
  })

  it("an interrupted attempt is shown and can be completed later exactly once", () => {
    const r = makeRepo()
    const q = r.id(["work", "ask", "Why is the build slow?"])
    const a1 = r.id(["work", "try", q, "--hypothesis", "cold cache", "--action", "time the build"])
    // The session ends here without a result.
    expect(r.brief().interrupted.map((x) => x.id)).toEqual([a1])

    const blocked = r.cli(["work", "try", q, "--hypothesis", "other", "--action", "other"])
    expect(blocked.code).toBe(1)
    expect(blocked.all).toContain("INTERRUPTED_ATTEMPT")
    expect(blocked.all).toContain(a1)

    r.ok(["work", "result", a1, "--outcome", "progress", "--result", "cache was cold"])
    const twice = r.cli(["work", "result", a1, "--outcome", "no_progress", "--result", "overwrite attempt"])
    expect(twice.code).toBe(1)
    expect(twice.all).toContain("ATTEMPT_ALREADY_RESOLVED")
    expect(r.brief().interrupted).toEqual([])
    const stored = JSON.parse(r.ok(["work", "export"]).out).attempts.find((a) => `A-${a.id}` === a1)
    expect(stored).toMatchObject({ status: "done", outcome: "progress", result: "cache was cold" })
  })

  it("refuses a damaged store instead of starting empty", () => {
    const r = makeRepo()
    r.id(["work", "ask", "keep me"])
    const file = r.storeFile()
    const good = fs.readFileSync(file)
    const dir = path.dirname(file)
    const listing = () => fs.readdirSync(dir).sort()

    for (const damaged of [Buffer.from("this is not a database at all, not even close........"), Buffer.alloc(0)]) {
      fs.writeFileSync(file, damaged)
      const before = listing()
      for (const args of [["work", "brief"], ["work", "ask", "new"]]) {
        const res = r.cli(args)
        expect(res.code).toBe(2)
        expect(res.all).toContain("STORE_UNREADABLE")
      }
      expect(fs.readFileSync(file).equals(damaged)).toBe(true)
      expect(listing()).toEqual(before)
    }

    if (process.getuid?.() !== 0) {
      fs.writeFileSync(file, good)
      fs.chmodSync(file, 0o000)
      const denied = r.cli(["work", "brief"])
      fs.chmodSync(file, 0o600)
      expect(denied.code).toBe(2)
      expect(denied.all).toContain("STORE_UNREADABLE")
      expect(fs.readFileSync(file).equals(good)).toBe(true)
    }

    // A newer schema, with committed changes still in the WAL.
    fs.writeFileSync(file, good)
    const keep = fs.mkdtempSync(path.join(os.tmpdir(), "gatectl-wal-"))
    sqliteScript(`
      import fs from "node:fs"
      const { DatabaseSync } = await import("node:sqlite")
      const db = new DatabaseSync(${JSON.stringify(file)})
      db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=999")
      for (const s of ["", "-wal"]) if (fs.existsSync(${JSON.stringify(file)} + s)) fs.copyFileSync(${JSON.stringify(file)} + s, ${JSON.stringify(keep)} + "/db" + s)
    `)
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(file + s, { force: true })
    fs.copyFileSync(path.join(keep, "db"), file)
    expect(fs.existsSync(path.join(keep, "db-wal"))).toBe(true)
    fs.copyFileSync(path.join(keep, "db-wal"), file + "-wal")
    const before = snapshot(file)
    const tooNew = r.cli(["work", "ask", "new"])
    expect(tooNew.code).toBe(2)
    expect(tooNew.all).toContain("STORE_TOO_NEW")
    const after = snapshot(file)
    expect(after.db.equals(before.db)).toBe(true)
    expect(after["-wal"].equals(before["-wal"])).toBe(true)

    // A shared-memory index left without its database is damage, not absence.
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(file + s, { force: true })
    fs.writeFileSync(file + "-shm", "left behind")
    for (const args of [["work", "brief"], ["work", "ask", "new"]]) expect(r.cli(args).all).toContain("STORE_UNREADABLE")
    expect(fs.existsSync(file)).toBe(false)

    // Each worktree keeps its own store.
    const r2 = makeRepo()
    r2.id(["work", "ask", "main worktree question"])
    const wt = `${r2.root}-wt`
    r2.git("worktree", "add", "-q", wt)
    const other = r2.cli(["work", "path"], { target: wt })
    expect(other.code).toBe(0)
    expect(other.out.trim()).not.toBe(r2.storeFile())
    const q = /\b(Q-\d+)\b/.exec(r2.cli(["work", "ask", "worktree question"], { target: wt }).out)[1]
    const wtBrief = JSON.parse(r2.cli(["work", "brief", "--json"], { target: wt }).out)
    expect(wtBrief.open_questions.map((x) => x.text)).toEqual(["worktree question"])
    expect(q).toBeTruthy()
    expect(r2.brief().open_questions.map((x) => x.text)).toEqual(["main worktree question"])
  })

  it("gates never read the work store", () => {
    // Static: nothing reachable from the gate, next, completion or hook modules imports the store.
    const importsOf = (file) => [...fs.readFileSync(file, "utf8").matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm)]
      .map((m) => m[1]).filter((s) => s.startsWith(".")).map((s) => path.resolve(path.dirname(file), s))
    const reachable = (entry, seen = new Set()) => {
      if (seen.has(entry)) return seen
      seen.add(entry)
      for (const dep of importsOf(entry)) if (fs.existsSync(dep)) reachable(dep, seen)
      return seen
    }
    for (const entry of ["core/gates.mjs", "core/next.mjs", "core/completion.mjs", "core/attest.mjs", "cli/plugin-hook.mjs"]) {
      const inside = [...reachable(path.join(SRC, entry))].filter((f) => f.startsWith(path.join(SRC, "context")))
      expect(inside, entry).toEqual([])
    }
    for (const f of fs.readdirSync(path.join(SRC, "core")))
      expect(fs.readFileSync(path.join(SRC, "core", f), "utf8"), f).not.toMatch(/context\//)
    const commands = fs.readFileSync(path.join(SRC, "cli/commands.mjs"), "utf8")
    expect(commands).not.toMatch(/from\s+["']\.\.\/context\//)
    expect(commands).toMatch(/import\(["']\.\.\/context\//)

    // Behavioural: the same repository gives the same gate answers whatever the store holds.
    const r = makeRepo()
    r.ok(["init"])
    r.ok(["new", "f1"])
    const answers = () => [r.cli(["next", "--json"]), r.cli(["status"])].map((x) => [x.code, x.out])
    const absent = answers()
    expect(fs.existsSync(r.storeFile())).toBe(false)
    const q = r.id(["work", "ask", "anything"])
    r.id(["work", "try", q, "--hypothesis", "h", "--action", "a"])
    r.ok(["work", "checkpoint", "--goal", "g", "--next", "n"])
    expect(answers()).toEqual(absent)
    fs.writeFileSync(r.storeFile(), "corrupted corrupted corrupted corrupted corrupted")
    expect(answers()).toEqual(absent)
  })

  it("concurrent writers cannot both win", async () => {
    const r = makeRepo()
    const q = r.id(["work", "ask", "race"])
    const a = r.id(["work", "try", q, "--hypothesis", "h", "--action", "a"])
    const results = await Promise.all([
      r.cliAsync(["work", "result", a, "--outcome", "progress", "--result", "first"]),
      r.cliAsync(["work", "result", a, "--outcome", "progress", "--result", "second"]),
    ])
    expect(results.map((x) => x.code).sort()).toEqual([0, 1])
    expect(results.find((x) => x.code === 1).all).toContain("ATTEMPT_ALREADY_RESOLVED")
    const winner = results.find((x) => x.code === 0)
    const stored = JSON.parse(r.ok(["work", "export"]).out).attempts.find((x) => `A-${x.id}` === a)
    expect(winner.all).toContain(a)
    expect(["first", "second"]).toContain(stored.result)

    const q2 = r.id(["work", "ask", "race two"])
    const tries = await Promise.all([1, 2].map(() => r.cliAsync(["work", "try", q2, "--hypothesis", "same", "--action", "same"])))
    expect(tries.map((x) => x.code).sort()).toEqual([0, 1])
    const attempts = JSON.parse(r.ok(["work", "export"]).out).attempts.filter((x) => `Q-${x.question_id}` === q2)
    expect(attempts).toHaveLength(1)
  })

  it("session start brief stays bounded and never breaks the hook", () => {
    const r = makeRepo()
    fs.mkdirSync(path.join(r.root, ".gatectl"))
    fs.writeFileSync(path.join(r.root, ".gatectl/policy.yaml"), "version: 1\ntiers: {}\n")
    const context = (env) => r.hook("SessionStart", env).hookSpecificOutput.additionalContext

    // No store yet: nothing about work state, and nothing is created.
    expect(context()).not.toMatch(/work state/i)
    expect(fs.existsSync(r.storeFile())).toBe(false)

    const at = "2026-09-25T00:00:00.000Z"
    const big = {
      format: "gatectl-work-export", version: 1, schema_version: 1, exported_at: at,
      questions: Array.from({ length: 300 }, (_, i) => ({ id: i + 1, work: "default", text: `Open question number ${i + 1} about a fairly long topic that takes space`, kind: "technical", status: "open", by: "agent", created_at: at, closed_at: null })),
      attempts: [], conclusions: [],
      checkpoints: [{ id: 1, work: "default", goal: "Keep the goal visible", done_when: null, next_action: "Do the next concrete step", summary: null, by: "agent", created_at: at }],
    }
    const exportFile = path.join(`${r.root}-state-export.json`)
    fs.writeFileSync(exportFile, JSON.stringify(big))
    r.ok(["work", "import", exportFile])
    const full = context()
    const marker = full.indexOf("Recorded work state")
    expect(marker).toBeGreaterThan(-1)
    const work = full.slice(full.indexOf("\n", marker) + 1)
    expect(work.length).toBeLessThanOrEqual(2000)
    expect(work).toContain("Keep the goal visible")
    expect(work).toContain("Do the next concrete step")
    expect(work).toMatch(/truncated/)
    expect(full).toContain("gatectl is enabled")

    const off = context({ GATECTL_WORK_SQLITE: "off" })
    expect(off).toContain("gatectl is enabled")
    expect(off).toMatch(/work state unavailable.*SQLITE_UNAVAILABLE/)
    const briefOff = r.cli(["work", "brief"], { env: { GATECTL_WORK_SQLITE: "off" } })
    expect(briefOff.code).toBe(2)
    expect(briefOff.all).toContain("SQLITE_UNAVAILABLE")
    expect(r.cli(["next", "--json"], { env: { GATECTL_WORK_SQLITE: "off" } }).code).toBe(0)

    // A goal longer than the whole budget is shortened; the next action still appears.
    const long = makeRepo()
    fs.mkdirSync(path.join(long.root, ".gatectl"))
    fs.writeFileSync(path.join(long.root, ".gatectl/policy.yaml"), "version: 1\ntiers: {}\n")
    long.ok(["work", "checkpoint", "--goal", "G".repeat(2100), "--done-when", "D".repeat(900), "--next", "the next concrete step"])
    const longContext = long.hook("SessionStart").hookSpecificOutput.additionalContext
    const longWork = longContext.slice(longContext.indexOf("\n", longContext.indexOf("Recorded work state")) + 1)
    expect(longWork.length).toBeLessThanOrEqual(2000)
    expect(longWork).toContain("Next: the next concrete step")

    // Without a store, a disabled node:sqlite is still reported rather than hidden.
    const bare = makeRepo()
    fs.mkdirSync(path.join(bare.root, ".gatectl"))
    fs.writeFileSync(path.join(bare.root, ".gatectl/policy.yaml"), "version: 1\ntiers: {}\n")
    expect(bare.hook("SessionStart", { GATECTL_WORK_SQLITE: "off" }).hookSpecificOutput.additionalContext)
      .toMatch(/work state unavailable.*SQLITE_UNAVAILABLE/)
    const bareBrief = bare.cli(["work", "brief", "--json"], { env: { GATECTL_WORK_SQLITE: "off" } })
    expect(bareBrief.code).toBe(2)
    expect(bareBrief.all).toContain("SQLITE_UNAVAILABLE")

    fs.writeFileSync(r.storeFile(), "corrupted corrupted corrupted corrupted corrupted")
    const damaged = context()
    expect(damaged).toContain("gatectl is enabled")
    expect(damaged).toMatch(/work state unavailable.*STORE_UNREADABLE/)
  })

  it("import is all or nothing", () => {
    const r = makeRepo()
    r.ok(["work", "checkpoint", "--goal", "g", "--next", "n"])
    const q = r.id(["work", "ask", "q"])
    const a = r.id(["work", "try", q, "--hypothesis", "h", "--action", "a", "--input", "src/a.js"])
    r.ok(["work", "result", a, "--outcome", "answered", "--result", "r", "--conclusion", "c", "--kind", "fact"])
    r.id(["work", "note", "n1", "--kind", "declaration", "--by", "user"])
    const original = JSON.parse(r.ok(["work", "export"]).out)
    const file = `${r.root}-export.json`
    fs.writeFileSync(file, JSON.stringify(original))

    const r2 = makeRepo()
    r2.ok(["work", "import", file])
    const copy = JSON.parse(r2.ok(["work", "export"]).out)
    const strip = (x) => ({ ...x, exported_at: null })
    expect(strip(copy)).toEqual(strip(original))
    const again = r2.cli(["work", "import", file])
    expect(again.code).toBe(1)
    expect(again.all).toContain("STORE_NOT_EMPTY")

    const escaping = structuredClone(original)
    escaping.conclusions[0].inputs = [{ path: "../../outside", fp: `sha256:${"0".repeat(64)}` }]
    fs.writeFileSync(file, JSON.stringify(escaping))
    const r4 = makeRepo()
    const escaped = r4.cli(["work", "import", file])
    expect(escaped.code).toBe(2)
    expect(escaped.all).toContain("IMPORT_INVALID")

    // A note tied to another work's question joins that work, so its own export restores.
    const cross = makeRepo()
    const qa = cross.id(["work", "ask", "question in a", "--work", "a"])
    cross.id(["work", "note", "about a", "--question", qa, "--work", "b"])
    const crossFile = `${cross.root}-export.json`
    fs.writeFileSync(crossFile, cross.ok(["work", "export"]).out)
    expect(JSON.parse(fs.readFileSync(crossFile, "utf8")).conclusions[0].work).toBe("a")
    makeRepo().ok(["work", "import", crossFile])

    const inconsistent = structuredClone(original)
    Object.assign(inconsistent.attempts[0], { result: null, resolved_at: null })
    fs.writeFileSync(file, JSON.stringify(inconsistent))
    expect(makeRepo().cli(["work", "import", file]).all).toContain("IMPORT_INVALID")
    const reordered = structuredClone(original)
    reordered.attempts[0].inputs = [{ path: "src/b.js", fp: "absent" }, { path: "src/a.js", fp: "absent" }]
    reordered.attempts[0].inputs_key = JSON.stringify([["src/b.js", "absent"], ["src/a.js", "absent"]])
    fs.writeFileSync(file, JSON.stringify(reordered))
    expect(makeRepo().cli(["work", "import", file]).all).toContain("IMPORT_INVALID")
    const rekeyed = structuredClone(original)
    rekeyed.attempts[0].inputs_key = "anything"
    fs.writeFileSync(file, JSON.stringify(rekeyed))
    expect(makeRepo().cli(["work", "import", file]).all).toContain("IMPORT_INVALID")

    const broken = { ...original, conclusions: [...original.conclusions, { ...original.conclusions[0], id: 999, attempt_id: 999 }] }
    fs.writeFileSync(file, JSON.stringify(broken))
    const r3 = makeRepo()
    const refused = r3.cli(["work", "import", file])
    expect(refused.code).toBe(2)
    expect(refused.all).toContain("IMPORT_INVALID")
    const empty = JSON.parse(r3.ok(["work", "export"]).out)
    expect([empty.questions, empty.attempts, empty.conclusions, empty.checkpoints]).toEqual([[], [], [], []])
  })
})
