import { describe, it, expect } from "vitest"
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

function run(args) {
  try {
    const stdout = execFileSync("node", ["bin/gatectl.mjs", ...args], { encoding: "utf8" })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout), stderr: String(e.stderr) }
  }
}

describe("rda CLI skeleton", () => {
  it("exits 2 with usage on no command", () => {
    const r = run([])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain("usage")
  })
  it("exits 2 on unknown command", () => {
    expect(run(["frobnicate"]).code).toBe(2)
  })
})

// The reader may go away before the CLI writes (`gatectl ... | head`). The CLI must still exit
// with its own code, not crash on EPIPE — and an open pipe must still receive everything.
describe("output to a pipe", () => {
  const child = (args, { closeEarly, cwd }) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.resolve("bin/gatectl.mjs"), ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let out = "", err = ""
    if (closeEarly) p.stdout.destroy()
    else p.stdout.on("data", (d) => { out += d })
    p.stderr.on("data", (d) => { err += d })
    const timer = setTimeout(() => p.kill("SIGKILL"), 20000)
    p.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, err }) })
  })

  it("a closed pipe does not turn into a crash", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gatectl-pipe-")))
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root })
    fs.mkdirSync(path.join(root, ".gatectl"))
    fs.writeFileSync(path.join(root, ".gatectl/policy.yaml"), "version: 1\ntiers: {}\n")
    execFileSync(process.execPath, [path.resolve("bin/gatectl.mjs"), "goal", "propose", "--goal", "g", "--owner-words", "w", "--target", root])
    const cases = [
      [["version"], 0],
      [["goal", "confirm", "--target", root], 1],
      [["frobnicate"], 2],
    ]
    for (const [args, expected] of cases) {
      const r = await child(args, { closeEarly: true, cwd: root })
      expect(r.signal, args.join(" ")).toBeNull()
      expect(r.code, `${args.join(" ")}: ${r.err}`).toBe(expected)
      expect(r.err).not.toMatch(/EPIPE|Unhandled 'error'/)
    }
    const full = await child(["capabilities", "--json", "--target", path.resolve(".")], { closeEarly: false, cwd: path.resolve(".") })
    expect(full.code, full.err).toBe(0)
    expect(full.out.length).toBeGreaterThan(8192)
    expect(JSON.parse(full.out).groups.length).toBeGreaterThan(0)
  }, 60000)
})
