// The line this integration must not cross: a gate's answer is a function of files on disk.
// Memory is networked, LLM-backed and asynchronously indexed. If a gate ever reads from it,
// `rda` stops being a trust anchor — so the boundary is checked by a machine, not by discipline.
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src")

const filesUnder = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? filesUnder(p) : p.endsWith(".mjs") ? [p] : []
  })

describe("memory boundary", () => {
  it("no file under src/core imports the memory adapter", () => {
    const offenders = filesUnder(path.join(SRC, "core")).filter((f) =>
      /import[^\n]*memory-tdam/.test(fs.readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
  })

  it("the gate module reaches no network primitive", () => {
    const gates = fs.readFileSync(path.join(SRC, "core/gates.mjs"), "utf8")
    for (const forbidden of ["fetch(", "node:http", "node:https", "undici", "memory"])
      expect(gates).not.toContain(forbidden)
  })

  it("the page renderer is pure — it performs no I/O of its own", () => {
    const page = fs.readFileSync(path.join(SRC, "core/memory-page.mjs"), "utf8")
    for (const forbidden of ["node:fs", "fetch(", "node:child_process"])
      expect(page).not.toContain(forbidden)
  })
})
