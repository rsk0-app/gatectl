// src/core/tier.mjs — tier is computed from paths, never chosen by hand.
export function globToRegExp(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0001")   // **/ may match zero dirs
    .replace(/\*\*/g, "\u0002")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0001/g, "(?:.*\/)?")
    .replace(/\u0002/g, ".*")
  return new RegExp(`^${re}$`)
}

export function matchesAny(path, globs) {
  return (globs ?? []).some((g) => globToRegExp(g).test(path))
}

const ORDER = ["A", "B", "C"] // A is highest ceremony

export function tierOf(changedPaths, policy) {
  const fallback = policy.unmatched_tier ?? "A"
  if (!ORDER.includes(fallback))
    throw new TypeError(`policy.unmatched_tier names an unknown tier: "${fallback}"`)
  let highest = 2 // index into ORDER; lower index = higher tier
  let any = false
  for (const p of changedPaths) {
    const idx = ORDER.findIndex((t) => matchesAny(p, policy.tiers?.[t]?.paths))
    const eff = idx === -1 ? ORDER.indexOf(fallback) : idx
    if (!any || eff < highest) highest = eff
    any = true
  }
  return any ? ORDER[highest] : fallback
}

export function higherTier(a, b) {
  const ia = ORDER.indexOf(a)
  const ib = ORDER.indexOf(b)
  if (ia === -1) throw new TypeError(`unknown tier: "${a}"`)
  if (ib === -1) throw new TypeError(`unknown tier: "${b}"`)
  return ORDER[Math.min(ia, ib)]
}

// #6: allowed_paths are a DECLARATION of intent; the diff is what happened. A wide glob
// (`src/**`) resolves to tier B while covering `src/lib/auth/**`, which is tier A — so a
// feature could be locked, reviewed and committed at B ceremony while actually shipping A-tier
// code. The effective tier is therefore the higher of declared and actual, recomputed from the
// real diff at every decision point. It only ever escalates: a narrow diff never buys a
// cheaper tier than the spec asked for.
//
// An empty diff resolves to the declared tier alone. tierOf([]) fails closed to unmatched_tier
// (A) by design, but gates L and R run BEFORE any implementation exists — folding that fallback
// in here would escalate every feature to tier A at lock time and make the rule meaningless.
export function effectiveTier(allowedPaths, changedPaths, policy) {
  const declared = tierOf(allowedPaths, policy)
  if (!changedPaths || changedPaths.length === 0) return declared
  return higherTier(declared, tierOf(changedPaths, policy))
}

// The engine's own bookkeeping is not shipped code and must not set the tier. spec.md,
// spec.lock.json, gates.json and ACTIVE all move during a normal cycle; under a policy whose
// tiers do not name docs/specs/** they fall through to unmatched_tier (A, fail-closed) and would
// escalate every feature in every repo to tier A — an escalation rule that always fires is the
// same as no rule at all. Mirrors the alwaysAllowed set in diffChecks, for the same reason.
// Meta-class paths are excluded for a different reason: an agent is forbidden to touch them at
// all, and diffChecks FAILs the gate by name when one moves. Escalating the tier on top of that
// adds noise, not safety — while at init time, before the first commit, .gatectl/policy.yaml itself
// is an unmatched new file and would escalate every first feature in every repo to tier A.
export function shippedPaths(changed, specDir, metaClass = []) {
  const engine = [`${specDir}/**`, "docs/specs/ACTIVE", ...metaClass]
  return (changed ?? []).filter((p) => !matchesAny(p, engine))
}
