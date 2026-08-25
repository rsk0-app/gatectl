// src/core/lock.mjs — the audit chain: every re-lock is a new version, history immutable.
import { createHash } from "node:crypto"

export const specDigest = (text) => createHash("sha256").update(text, "utf8").digest("hex")

export function appendLock(locks, entry) {
  const prev = locks[locks.length - 1]
  if (prev && prev.digest === entry.digest) return locks
  return [...locks, { version: locks.length + 1, ...entry }]
}

export const latestLock = (locks) => locks[locks.length - 1] ?? null
