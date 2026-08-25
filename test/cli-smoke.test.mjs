import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"

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
