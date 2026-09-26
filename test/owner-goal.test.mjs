// The owner's goal, and the difference between "the owner confirmed it" and "an agent wrote that the
// owner confirmed it". Only what the gatectl hook saw the owner send counts, and only a dedicated
// message naming the exact draft.
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import yaml from "js-yaml"
import { execFileSync, spawn, spawnSync } from "node:child_process"

const BIN = path.resolve("bin/gatectl.mjs")
const SRC = path.resolve("src")
const ID = /G-[0-9a-f]{64}\b/

function makeRepo({ policy = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gatectl-goal-")))
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t")
  git("commit", "-q", "--allow-empty", "-m", "init")
  if (policy) {
    fs.mkdirSync(path.join(root, ".gatectl"))
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), "version: 1\ntiers: {}\n")
  }
  const state = `${root}-state`
  const env = { ...process.env, GATECTL_STATE_DIR: state }
  delete env.GATECTL_WORK_SQLITE
  const cli = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args, "--target", root], { cwd: root, env: { ...env, ...extra }, encoding: "utf8" })
    return { code: r.status, out: r.stdout, all: `${r.stdout}${r.stderr}` }
  }
  const ok = (args, extra) => { const r = cli(args, extra); expect(r.code, r.all).toBe(0); return r }
  const hookArgs = (input) => ({ cwd: root, encoding: "utf8", input: JSON.stringify({ cwd: root, session_id: "s-1", ...input }) })
  const hook = (input, extra = {}) => {
    const r = spawnSync(process.execPath, [BIN, "hook"], { ...hookArgs(input), env: { ...env, ...extra } })
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(r.stdout)
  }
  const say = (prompt, extra) => hook({ hook_event_name: "UserPromptSubmit", prompt }, extra)
  const sayAsync = (prompt) => new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, "hook"], { cwd: root, env })
    child.stdin.end(JSON.stringify({ cwd: root, session_id: "s-2", hook_event_name: "UserPromptSubmit", prompt }))
    child.on("close", resolve)
  })
  const start = (extra) => hook({ hook_event_name: "SessionStart" }, extra).hookSpecificOutput.additionalContext
  const show = (extra) => JSON.parse(ok(["goal", "show", "--json"], extra).out)
  const goalFile = path.join(root, "docs/goal.yaml")
  const logDir = () => path.join(state, fs.readdirSync(state).find((d) => d !== "keys"))
  return { root, state, cli, ok, say, sayAsync, start, show, goalFile, logDir }
}

const propose = (r, extra = []) => {
  const out = r.ok(["goal", "propose", "--goal", "Agents keep the owner's goal", "--owner-words", "не терял цель",
    "--owner-words", "invented words", "--success", "a new session continues", "--out-of-scope", "a GUI", ...extra]).out
  return { out, id: ID.exec(out)[0] }
}

describe("owner goal", { timeout: 60000 }, () => {
  it("drafts the goal with an id and checks the owner's words", () => {
    const r = makeRepo()
    r.say("Хочу, чтобы агент не терял цель и не ходил по кругу")
    const { out, id } = propose(r)
    expect(out).toContain(`подтверждаю цель ${id}`)
    const file = yaml.load(fs.readFileSync(r.goalFile, "utf8"))
    expect(file).toMatchObject({ goal: "Agents keep the owner's goal", success: ["a new session continues"],
      out_of_scope: ["a GUI"], owner_words: ["не терял цель", "invented words"], confirmation: null })
    const shown = r.show()
    expect(shown.id).toBe(id)
    expect(shown.status).toBe("draft")
    expect(shown.owner_words).toEqual([{ text: "не терял цель", observed: "found" }, { text: "invented words", observed: "not found" }])
    expect(r.ok(["goal", "show"]).out).toContain("not confirmed by the owner")
  })

  it("confirmation needs the owner's dedicated message for this exact draft", () => {
    const r = makeRepo()
    r.say("Хочу, чтобы агент не терял цель")
    const first = propose(r).id
    const refused = () => {
      const c = r.cli(["goal", "confirm"])
      expect(c.code).toBe(1)
      expect(c.all).toContain("OWNER_CONFIRMATION_NOT_OBSERVED")
    }
    refused()
    r.say(`я не подтверждаю цель ${first}`)
    refused()
    r.say(`подтверждаю цель ${first.slice(0, 14)}`)
    refused()

    // A new draft: a confirmation of the earlier one does not carry over.
    const second = propose(r, ["--success", "the owner sees the next step"]).id
    expect(second).not.toBe(first)
    r.say(`подтверждаю цель ${first}`)
    refused()
    // Sent before this draft was written: re-proposing the same content resets the clock.
    r.say(`подтверждаю цель ${second}`)
    expect(propose(r, ["--success", "the owner sees the next step"]).id).toBe(second)
    refused()

    r.say(`  Подтверждаю цель ${second}. `)
    const c = r.ok(["goal", "confirm"])
    expect(c.out).toContain("not cryptographic")
    expect(r.show().status).toBe("confirmed")

    // Elsewhere: the repository records it, this machine never saw it.
    expect(r.show({ GATECTL_STATE_DIR: `${r.state}-other` }).status).toBe("confirmed elsewhere (not verified here)")

    // Any agreed field edited by hand, including the owner's own words.
    const text = fs.readFileSync(r.goalFile, "utf8")
    fs.writeFileSync(r.goalFile, text.replace("не терял цель", "строил платформу"))
    expect(r.show().status).toBe("changed since the owner confirmed it")
    fs.writeFileSync(r.goalFile, text)
    expect(r.show().status).toBe("confirmed")

    propose(r, ["--success", "something new"])
    expect(r.show().status).toBe("draft")
  })

  it("every session starts from the owner goal", () => {
    const r = makeRepo()
    expect(r.start()).not.toMatch(/Owner goal/)
    propose(r)
    for (const env of [{}, { GATECTL_WORK_SQLITE: "off" }]) {
      const context = r.start(env)
      expect(context).toMatch(/Owner goal \[draft — not confirmed by the owner\]: Agents keep the owner's goal/)
      expect(context).toContain("a new session continues")
      expect(context).toContain("gatectl is enabled")
    }
    // Without a work store the brief still leads with the goal, and creates no store.
    expect(JSON.parse(r.ok(["work", "brief", "--json"]).out).owner_goal).toMatchObject({ status: "draft" })
    expect(fs.existsSync(r.ok(["work", "path"]).out.trim())).toBe(false)
    r.ok(["work", "checkpoint", "--next", "n"])
    expect(JSON.parse(r.ok(["work", "brief", "--json"]).out).owner_goal)
      .toMatchObject({ status: "draft", goal: "Agents keep the owner's goal" })
    expect(r.ok(["work", "brief"]).out.split("\n")[0]).toMatch(/^Owner goal \[draft/)
  })

  it("observation is bounded, concurrent-safe and never breaks the hook", async () => {
    const r = makeRepo()
    r.say("first")
    expect(fs.existsSync(r.state), "the hook recorded nothing").toBe(true)
    const log = path.join(r.logDir(), "owner-prompts.jsonl")
    expect(fs.statSync(log).mode & 0o777).toBe(0o600)
    const { recordPrompt } = await import("../src/core/goal.mjs")
    const env = { ...process.env, GATECTL_STATE_DIR: r.state }
    for (let i = 0; i < 450; i++) recordPrompt(r.root, { text: `prompt ${i}`, session: "s", at: new Date().toISOString() }, env)
    const generations = [`${log}.1`, log].filter(fs.existsSync)
    const lines = generations.flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n")).map((l) => JSON.parse(l))
    expect(lines.length).toBeLessThanOrEqual(200)
    for (const f of generations) expect(fs.statSync(f).mode & 0o777).toBe(0o600)
    expect(lines.at(-1).text).toBe("prompt 449")
    r.say("x".repeat(5000))
    const long = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1)
    expect(long.text.length).toBe(4000)
    expect(long.truncated).toBe(true)

    const id = propose(r).id
    const messages = Array.from({ length: 12 }, (_, i) => (i % 4 === 0 ? `подтверждаю цель ${id}` : `noise ${i}`))
    await Promise.all(messages.map((m) => r.sayAsync(m)))
    const confirmations = fs.readFileSync(path.join(r.logDir(), "owner-confirmations.jsonl"), "utf8").trim().split("\n")
    expect(confirmations.filter((l) => JSON.parse(l).id === id)).toHaveLength(3)

    const bare = makeRepo({ policy: false })
    bare.say("not enabled here")
    expect(fs.existsSync(bare.state)).toBe(false)

    const blocked = makeRepo()
    fs.writeFileSync(blocked.state, "a file where the state directory should be")
    expect(blocked.say("still fine").hookSpecificOutput.additionalContext).toContain("gatectl is enabled")
  })

  it("gates never read the owner goal", () => {
    const importsOf = (file) => [...fs.readFileSync(file, "utf8").matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm)]
      .map((m) => m[1]).filter((s) => s.startsWith(".")).map((s) => path.resolve(path.dirname(file), s))
    const reachable = (entry, seen = new Set()) => {
      if (seen.has(entry)) return seen
      seen.add(entry)
      for (const dep of importsOf(entry)) if (fs.existsSync(dep)) reachable(dep, seen)
      return seen
    }
    expect(fs.existsSync(path.join(SRC, "core/goal.mjs"))).toBe(true)
    for (const entry of ["core/gates.mjs", "core/next.mjs", "core/completion.mjs", "core/attest.mjs"]) {
      const bad = [...reachable(path.join(SRC, entry))].filter((f) => f === path.join(SRC, "core/goal.mjs") || f.startsWith(path.join(SRC, "context")))
      expect(bad, entry).toEqual([])
      for (const f of reachable(path.join(SRC, entry)))
        expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/owner-prompts|owner-confirmations|goal\.yaml/)
    }

    const r = makeRepo()
    r.ok(["init"])
    r.ok(["new", "f1"])
    const answers = () => [r.cli(["next", "--json"]), r.cli(["status"])].map((x) => [x.code, x.out])
    const before = answers()
    r.say("some owner words")
    r.say(`подтверждаю цель G-${"a".repeat(64)}`)
    expect(answers()).toEqual(before)
    for (const f of ["owner-prompts.jsonl", "owner-confirmations.jsonl"]) fs.writeFileSync(path.join(r.logDir(), f), "{not json")
    expect(answers()).toEqual(before)
  })
})
