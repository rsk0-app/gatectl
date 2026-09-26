// src/context/cli.mjs — `gatectl work ...`. Loaded lazily by commands.mjs, and only for `work`.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import yaml from "js-yaml"
import { treeDigest } from "../core/target.mjs"
import { WorkError, loadSqlite, openStore, orphanCompanion, storePath, worktreeRoot } from "./store.mjs"
import * as work from "./work.mjs"
import { renderBrief } from "./brief.mjs"
import { readGoal, goalStatus } from "../core/goal.mjs"

const USAGE = `usage: gatectl work <command> [--work <id>] [--by <who>] [--target <path>]
  ask "<question>" [--decision]                  record an open question (or a decision needed from the owner)
  try Q-n --hypothesis <h> --action <a> [--input <file>]... [--reason <why>]
                                                 start an attempt; refused if it repeats one on unchanged inputs
  result A-n --outcome progress|no_progress|answered|blocked --result <text>
         [--conclusion <text> --kind declaration|fact|hypothesis|check] [--input <file>]... [--remaining <t>] [--revisit <t>]
  answer Q-n "<answer>"                          close a question with a declared answer
  note "<statement>" [--kind ...] [--input <file>]... [--question Q-n]
  checkpoint --next <action> [--goal <g>] [--done-when <c>] [--summary <s>]
  brief [--json] [--max-chars <n>]               goal, next action, decisions, interrupted/exhausted work, conclusions
  export | import <file> | path`

const BOOLEAN = new Set(["--json", "--decision", "--without-owner-goal"])
function parse(args) {
  const flags = {}, positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith("--")) { positional.push(a); continue }
    if (BOOLEAN.has(a)) { flags[a.slice(2)] = true; continue }
    if (i + 1 >= args.length) throw new WorkError("USAGE", `${a} needs a value`)
    const key = a.slice(2), value = args[++i]
    if (key === "input") (flags.input ??= []).push(value)
    else flags[key] = value
  }
  return { flags, positional }
}

// The work id: explicit, else the active gatectl feature, else "default".
function workId(root, flags) {
  const explicit = flags.work
  const active = (() => { try { return fs.readFileSync(path.join(root, "docs/specs/ACTIVE"), "utf8").trim() } catch { return null } })()
  const id = explicit ?? (active || "default")
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw new WorkError("USAGE", `work id ${JSON.stringify(id)} must be letters, digits, '.', '_' or '-'`)
  return id
}

function specGoal(root, id) {
  try {
    const intent = yaml.load(fs.readFileSync(path.join(root, "docs/specs", id, "spec.yaml"), "utf8"))?.intent
    if (typeof intent !== "string" || /^\s*(REPLACE|Зачем сейчас)/.test(intent)) return null
    const first = intent.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ")
    return first.length > 300 ? first.slice(0, 299) + "…" : first
  } catch { return null }
}

// node:sqlite is unflagged from Node 22.13 / 23.4. Between 22.5 and those, it exists behind a flag;
// re-running this one command with the flag is cheaper than asking every user to upgrade Node.
function reexecWithFlag(args, env) {
  if (env.GATECTL_WORK_SQLITE === "off" || env.GATECTL_WORK_REEXEC) return null
  if (!process.allowedNodeEnvironmentFlags.has("--experimental-sqlite")) return null
  const r = spawnSync(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", process.argv[1], "work", ...args],
    { stdio: "inherit", env: { ...env, GATECTL_WORK_REEXEC: "1" } })
  return r.status ?? 2
}

function ownerGoal(root) {
  try { const g = readGoal(root); return g ? goalStatus(root, g) : null }
  catch (e) { return { status: "unreadable", goal: e.message } }
}

export async function runWork(args, root, env = process.env) {
  try {
    const clean = [...args]
    const t = clean.indexOf("--target")
    if (t !== -1) clean.splice(t, 2)
    const [cmd, ...rest] = clean
    if (!cmd || cmd === "help" || cmd === "--help") { console.log(USAGE); return cmd ? 0 : 2 }
    const { flags, positional } = parse(rest)
    const top = worktreeRoot(root)
    const file = storePath(top)
    if (cmd === "path") { console.log(file); return 0 }
    const reading = ["brief", "export"].includes(cmd)
    let importData = null
    if (cmd === "import") {
      if (!positional[0]) throw new WorkError("USAGE", "work import needs a file")
      try { importData = JSON.parse(fs.readFileSync(path.resolve(positional[0]), "utf8")) }
      catch (e) { throw new WorkError("IMPORT_INVALID", `cannot read ${positional[0]}: ${e.message}`) }
      work.validateExport(importData)
    }

    const sqlite = await loadSqlite(env)
    if (!sqlite) {
      const code = reexecWithFlag(args, env)
      if (code !== null) return code
      throw new WorkError("SQLITE_UNAVAILABLE", env.GATECTL_WORK_SQLITE === "off"
        ? "the work store is disabled (GATECTL_WORK_SQLITE=off)"
        : `node:sqlite is not available on Node ${process.versions.node}; the work store needs Node >= 22.13 (or 22.5+ with --experimental-sqlite). Gates are unaffected.`)
    }
    // Reading never creates a store: an absent one is simply empty — but the owner's goal, which
    // lives in the repository, is still shown.
    if (reading && !fs.existsSync(file) && !orphanCompanion(file)) {
      if (cmd === "export") { console.log(JSON.stringify(work.emptyExport(), null, 2)); return 0 }
      const owner = flags["without-owner-goal"] ? null : ownerGoal(top)
      if (!owner) { if (flags.json) console.log(JSON.stringify(null)); return 0 }
      const b = { ...work.emptyBrief(workId(top, flags), specGoal(top, workId(top, flags))), owner_goal: owner }
      console.log(flags.json ? JSON.stringify(b, null, 2) : renderBrief(b, flags["max-chars"] ? Number(flags["max-chars"]) : Infinity))
      return 0
    }
    const db = openStore(top, sqlite, { create: !reading })
    try {
      const by = flags.by ?? "agent"
      const id = () => workId(top, flags)
      const treeKey = () => treeDigest(top)
      switch (cmd) {
        case "ask":
          console.log(`${work.ask(db, { work: id(), text: positional.join(" "), decision: !!flags.decision, by })} recorded`)
          return 0
        case "try":
          console.log(`${work.tryAttempt(db, top, { questionRef: positional[0], hypothesis: flags.hypothesis, action: flags.action,
            inputs: flags.input ?? [], reason: flags.reason, by, treeKey })} started — record its outcome with \`gatectl work result\``)
          return 0
        case "result": {
          const r = work.result(db, top, { attemptRef: positional[0], outcome: flags.outcome, text: flags.result,
            conclusion: flags.conclusion, kind: flags.kind, inputs: flags.input ?? [], remaining: flags.remaining, revisit: flags.revisit, by })
          console.log(`${r.attempt} recorded: ${flags.outcome}${r.conclusion ? `; conclusion ${r.conclusion}` : ""}`)
          return 0
        }
        case "answer":
          console.log(`${work.answer(db, top, { questionRef: positional[0], text: positional.slice(1).join(" "), by })} recorded; ${positional[0]} answered`)
          return 0
        case "note":
          console.log(`${work.note(db, top, { work: id(), text: positional.join(" "), kind: flags.kind, inputs: flags.input ?? [], questionRef: flags.question, by })} recorded`)
          return 0
        case "checkpoint":
          console.log(`${work.checkpoint(db, { work: id(), goal: flags.goal, doneWhen: flags["done-when"], next: flags.next, summary: flags.summary, by })} recorded`)
          return 0
        case "brief": {
          const b = work.brief(db, top, { work: id(), specGoal: specGoal(top, id()) })
          // The owner's goal comes first. SessionStart shows it itself, so it asks for the brief without.
          if (!flags["without-owner-goal"]) b.owner_goal = ownerGoal(top)
          if (flags.json) console.log(JSON.stringify(b, null, 2))
          else {
            const max = flags["max-chars"] ? Number(flags["max-chars"]) : Infinity
            if (!(max > 0)) throw new WorkError("USAGE", "--max-chars must be a positive number")
            console.log(renderBrief(b, max))
          }
          return 0
        }
        case "export":
          console.log(JSON.stringify(work.exportAll(db), null, 2))
          return 0
        case "import":
          work.importAll(db, importData)
          console.log(`imported ${["questions", "attempts", "conclusions", "checkpoints"].map((t) => `${importData[t].length} ${t}`).join(", ")}`)
          return 0
        default:
          throw new WorkError("USAGE", `unknown work command ${JSON.stringify(cmd)}\n${USAGE}`)
      }
    } finally {
      db?.close()
    }
  } catch (e) {
    if (e instanceof WorkError) { console.error(e.message); return e.exit }
    throw e
  }
}
