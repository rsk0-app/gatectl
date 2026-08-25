// src/core/ledger.mjs — the gate ledger: append-only, MAC-chained, and NOT stored in the target
// repository. Two separate problems live here.
//
// The first is authority. A JSON file in the worktree is append-only by discipline only: the
// same agent whose work is being gated can rewrite it, and a forged green is indistinguishable
// from an earned one. Every entry therefore carries an HMAC over its own body AND over the
// previous entry's MAC, so editing, deleting or reordering any line invalidates every line
// after it. Forging now requires the key, not a text editor.
//
// The honest limit, stated once here rather than implied: a prefix of a valid chain is itself a
// valid chain, so the ledger alone cannot prove nothing was truncated. That is what the head MAC
// is for — an attestation binds to it, and a truncated ledger no longer matches the attestation.
// And a local key readable by the same user is a bar, not a wall: it stops tampering in the
// repository and accidental rewrites, not an agent that goes looking for the key file.
//
// The second problem is that the ledger used to gate itself: it lived in the hashed tree while
// being appended to by the very gates that hashed it. Out of the repository, that whole class of
// exclusion disappears — a tree digest is now exactly the tree, with nothing carved out.
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const mac = (key, payload) => crypto.createHmac("sha256", key).update(payload).digest("hex")

// The MAC covers the entry and the link together: signing them separately would let a valid
// entry be lifted into a different position in the chain.
const body = (entry, prev) => JSON.stringify({ entry, prev })

export function appendEntry(ledgerPath, entry, key) {
  const prev = fs.existsSync(ledgerPath) ? lastMac(ledgerPath) : ""
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
  fs.appendFileSync(ledgerPath, JSON.stringify({ entry, prev, mac: mac(key, body(entry, prev)) }) + "\n")
}

function lines(ledgerPath) {
  return fs.readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim())
}

function lastMac(ledgerPath) {
  const all = lines(ledgerPath)
  if (all.length === 0) return ""
  try { return JSON.parse(all[all.length - 1]).mac ?? "" } catch { return "" }
}

// Returns { ok, entries, head, detail }. A ledger that does not verify yields ok:false and NO
// entries: a caller must never be able to read a green out of a ledger it could not trust, so
// the failure is total rather than per-entry.
export function readLedger(ledgerPath, key) {
  if (!fs.existsSync(ledgerPath)) return { ok: true, entries: [], head: "" }
  const entries = []
  let prev = ""
  let i = 0
  for (const raw of lines(ledgerPath)) {
    i += 1
    let line
    try { line = JSON.parse(raw) } catch { return { ok: false, entries: [], head: "", detail: `entry ${i} is not valid JSON` } }
    if (line.prev !== prev)
      return { ok: false, entries: [], head: "", detail: `entry ${i} breaks the chain — an entry was edited, deleted or reordered` }
    if (line.mac !== mac(key, body(line.entry, line.prev)))
      return { ok: false, entries: [], head: "", detail: `entry ${i} does not match its signature — the ledger was modified outside gatectl, or signed with another key` }
    entries.push(line.entry)
    prev = line.mac
  }
  return { ok: true, entries, head: prev }
}
