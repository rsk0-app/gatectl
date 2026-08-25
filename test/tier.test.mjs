import { describe, it, expect } from "vitest"
import { globToRegExp, matchesAny, tierOf, higherTier, effectiveTier, shippedPaths } from "../src/core/tier.mjs"

const POLICY = {
  unmatched_tier: "A",
  tiers: {
    A: { paths: ["supabase/migrations/**", "src/app/api/**", "middleware.ts"] },
    B: { paths: ["src/**", "test/**", "package.json"] },
    C: { paths: ["docs/**", "**/*.md", "public/**"] },
  },
}

describe("glob matching", () => {
  it("** crosses directories, * does not", () => {
    expect(matchesAny("src/a/b/c.ts", ["src/**"])).toBe(true)
    expect(matchesAny("src/a/b/c.ts", ["src/*"])).toBe(false)
    expect(matchesAny("middleware.ts", ["middleware.ts"])).toBe(true)
    expect(matchesAny("docs/x/y.md", ["**/*.md"])).toBe(true)
  })
  it("does not treat dots as wildcards", () => {
    expect(matchesAny("middlewareXts", ["middleware.ts"])).toBe(false)
  })
})

describe("tierOf", () => {
  it("single-tier diffs resolve to their tier", () => {
    expect(tierOf(["docs/readme.md"], POLICY)).toBe("C")
    expect(tierOf(["src/lib/x.ts"], POLICY)).toBe("B")
    expect(tierOf(["supabase/migrations/001.sql"], POLICY)).toBe("A")
  })
  it("a diff spanning tiers takes the highest", () => {
    expect(tierOf(["docs/readme.md", "src/lib/x.ts"], POLICY)).toBe("B")
    expect(tierOf(["docs/readme.md", "src/app/api/r.ts"], POLICY)).toBe("A")
  })
  it("an unmatched path fails closed to unmatched_tier", () => {
    expect(tierOf(["Makefile"], POLICY)).toBe("A")
  })
  it("A-tier globs win over B even though B's src/** also matches", () => {
    expect(tierOf(["src/app/api/route.ts"], POLICY)).toBe("A")
  })
  it("an empty diff fails closed to unmatched_tier", () => {
    expect(tierOf([], POLICY)).toBe("A")
  })
  it("C4: an unknown unmatched_tier must never resolve — never silently PASS", () => {
    const bad = { ...POLICY, unmatched_tier: "unmatched_tier" }
    expect(() => tierOf(["Makefile"], bad)).toThrow(TypeError)
    expect(() => tierOf([], bad)).toThrow(TypeError)
  })
})

// #6: a spec's allowed_paths declare INTENT; the diff is what actually happened. A spec locked
// as tier B whose glob is wide enough to cover a tier-A path must not ship through tier B's
// ceremony — the effective tier is the higher of the two, always.
describe("higherTier", () => {
  it("returns the more ceremonious of two tiers, in either order", () => {
    expect(higherTier("B", "A")).toBe("A")
    expect(higherTier("A", "B")).toBe("A")
    expect(higherTier("C", "B")).toBe("B")
    expect(higherTier("B", "B")).toBe("B")
  })
  it("refuses an unknown tier rather than resolving it", () => {
    expect(() => higherTier("B", "Z")).toThrow(TypeError)
    expect(() => higherTier(undefined, "B")).toThrow(TypeError)
  })
})

describe("effectiveTier", () => {
  it("escalates when the actual diff is more sensitive than the declared paths", () => {
    // declared src/** → B, but the diff touched src/app/api → A
    expect(effectiveTier(["src/**"], ["src/app/api/route.ts"], POLICY)).toBe("A")
  })
  it("never de-escalates below the declared tier", () => {
    expect(effectiveTier(["src/app/api/**"], ["docs/x.md"], POLICY)).toBe("A")
  })
  it("an empty diff resolves to the declared tier, not to unmatched_tier", () => {
    // lock and red run before any implementation exists; an empty diff must not force tier A
    expect(effectiveTier(["docs/**"], [], POLICY)).toBe("C")
  })
  it("an unmatched changed path still fails closed", () => {
    expect(effectiveTier(["docs/**"], ["Makefile"], POLICY)).toBe("A")
  })
})

describe("shippedPaths", () => {
  it("drops the feature's own spec dir and ACTIVE, keeps real code", () => {
    const changed = ["docs/specs/f1/spec.md", "docs/specs/f1/spec.lock.json", "docs/specs/f1/gates.json",
                     "docs/specs/ACTIVE", "src/impl.ts"]
    expect(shippedPaths(changed, "docs/specs/f1")).toEqual(["src/impl.ts"])
  })
  it("keeps ANOTHER feature's spec dir — that is a real change to a file this feature does not own", () => {
    expect(shippedPaths(["docs/specs/f2/spec.md"], "docs/specs/f1")).toEqual(["docs/specs/f2/spec.md"])
  })
  it("without it, engine bookkeeping alone would escalate to unmatched_tier", () => {
    // a policy whose tiers do not name docs/** at all — the common case for a code-only repo
    const codeOnly = { unmatched_tier: "A", tiers: { A: { paths: ["src/app/api/**"] }, B: { paths: ["src/**"] } } }
    expect(effectiveTier(["src/**"], ["docs/specs/f1/spec.lock.json"], codeOnly)).toBe("A")
    expect(effectiveTier(["src/**"], shippedPaths(["docs/specs/f1/spec.lock.json"], "docs/specs/f1"), codeOnly)).toBe("B")
  })
})

describe("shippedPaths — meta-class", () => {
  it("drops meta-class paths: touching one is already a named Gfull failure, not a tier signal", () => {
    expect(shippedPaths([".gatectl/policy.yaml", "src/a.ts"], "docs/specs/f1", [".gatectl/**"])).toEqual(["src/a.ts"])
  })
})
