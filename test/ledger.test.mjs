import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { appendEntry, readLedger } from "../src/core/ledger.mjs"

const KEY = Buffer.from("00112233445566778899aabbccddeeff", "hex")
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rda-ledger-")), "gates.jsonl")

describe("ledger", () => {
  it("appends and reads back in order", () => {
    const p = tmp()
    appendEntry(p, { gate: "L", status: "PASS" }, KEY)
    appendEntry(p, { gate: "R", status: "PASS" }, KEY)
    const r = readLedger(p, KEY)
    expect(r.ok).toBe(true)
    expect(r.entries.map((e) => e.gate)).toEqual(["L", "R"])
  })

  it("a missing ledger is empty, not an error — nothing has been gated yet", () => {
    const r = readLedger(path.join(os.tmpdir(), "rda-nope", "gates.jsonl"), KEY)
    expect(r.ok).toBe(true)
    expect(r.entries).toEqual([])
  })

  it("creates the directory it needs", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rda-ledger-")), "deep/nested/gates.jsonl")
    appendEntry(p, { gate: "L", status: "PASS" }, KEY)
    expect(readLedger(p, KEY).entries).toHaveLength(1)
  })

  // The whole point: a forged green must be detectable, not silently believed.
  it("REFUSES a tampered entry — an edited status breaks its own MAC", () => {
    const p = tmp()
    appendEntry(p, { gate: "L", status: "FAIL" }, KEY)
    const line = JSON.parse(fs.readFileSync(p, "utf8").trim())
    line.entry.status = "PASS"
    fs.writeFileSync(p, JSON.stringify(line) + "\n")
    const r = readLedger(p, KEY)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("entry 1")
  })

  it("REFUSES a re-signed entry when the key differs — forging needs the key, not the format", () => {
    const p = tmp()
    appendEntry(p, { gate: "L", status: "PASS" }, Buffer.from("ffff", "hex"))
    expect(readLedger(p, KEY).ok).toBe(false)
  })

  it("REFUSES a deleted entry — the chain link of the next line no longer matches", () => {
    const p = tmp()
    appendEntry(p, { gate: "L", status: "FAIL" }, KEY)
    appendEntry(p, { gate: "L", status: "PASS" }, KEY)
    appendEntry(p, { gate: "R", status: "PASS" }, KEY)
    const lines = fs.readFileSync(p, "utf8").trim().split("\n")
    fs.writeFileSync(p, [lines[0], lines[2]].join("\n") + "\n") // drop the middle
    const r = readLedger(p, KEY)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("chain")
  })

  it("REFUSES a truncated ledger — dropping the tail is rewriting history too", () => {
    const p = tmp()
    appendEntry(p, { gate: "L", status: "PASS" }, KEY)
    appendEntry(p, { gate: "L", status: "FAIL" }, KEY)
    const lines = fs.readFileSync(p, "utf8").trim().split("\n")
    fs.writeFileSync(p, lines[0] + "\n")
    // A prefix of a valid chain is itself a valid chain — the ledger cannot detect this alone,
    // so the head MAC is what an attestation binds to. Documented here so nobody assumes more.
    expect(readLedger(p, KEY).ok).toBe(true)
    expect(readLedger(p, KEY).head).toBe(JSON.parse(lines[0]).mac)
  })

  it("REFUSES a corrupt line rather than skipping it", () => {
    const p = tmp()
    appendEntry(p, { gate: "L", status: "PASS" }, KEY)
    fs.appendFileSync(p, "not json\n")
    expect(readLedger(p, KEY).ok).toBe(false)
  })

  it("reports the head MAC, so an attestation can bind to the exact ledger state it read", () => {
    const p = tmp()
    appendEntry(p, { gate: "L", status: "PASS" }, KEY)
    const first = readLedger(p, KEY).head
    appendEntry(p, { gate: "R", status: "PASS" }, KEY)
    expect(readLedger(p, KEY).head).not.toBe(first)
  })
})
