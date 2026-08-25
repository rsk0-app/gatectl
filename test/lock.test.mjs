import { describe, it, expect } from "vitest"
import { specDigest, appendLock, latestLock } from "../src/core/lock.mjs"

describe("lock chain", () => {
  it("digest is stable and content-sensitive", () => {
    expect(specDigest("a")).toBe(specDigest("a"))
    expect(specDigest("a")).not.toBe(specDigest("b"))
  })
  it("appends version 1 then 2; same digest is a no-op", () => {
    const e = (d) => ({ digest: d, at: "t", tier: "B", requiredTests: [], allowedPaths: [] })
    let locks = appendLock([], e("d1"))
    expect(locks).toHaveLength(1)
    expect(locks[0].version).toBe(1)
    locks = appendLock(locks, e("d1"))
    expect(locks).toHaveLength(1) // no-op
    locks = appendLock(locks, e("d2"))
    expect(locks[1].version).toBe(2)
    expect(latestLock(locks).digest).toBe("d2")
  })
  it("prior versions are never mutated", () => {
    const locks = appendLock(appendLock([], { digest: "d1", at: "t" }), { digest: "d2", at: "t" })
    expect(locks[0].digest).toBe("d1")
  })
})
