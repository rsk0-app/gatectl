// src/core/replay.mjs — what "this test was RED" is allowed to mean.
//
// Until now gate R proved something about a working tree that no longer exists by the time
// anyone reads the claim. The implementation lands, the tree moves, and the evidence says "it
// was red when I looked" — unfalsifiable, and worth about as much as the agent's word.
//
// A replayable RED is a statement about two trees that both still exist:
//
//   base commit + only the test changes   → every criterion's test must FAIL, for its own reason
//   the final tree                        → the same test must PASS
//
// Anyone can rebuild both from git and run them again. Which is the whole point: the evidence
// stops being a memory and becomes an experiment someone else can repeat.
//
// This module decides WHICH files make up "only the test changes". Everything touching git lives
// in the CLI, because that is I/O; the rule below is the part worth testing on its own.

// A file belongs to the test patch when the policy says its path is test territory, or when it
// is one of the files a criterion names. The second half matters: a project whose tests live
// somewhere unusual should not have to restate that in two places, and a criterion pointing at a
// file outside the declared test paths is a spec problem, not a reason to silently drop the file
// from the replay.
export function testPatch({ changed, obligationFiles = [], testGlobs = [], matches }) {
  const named = new Set(obligationFiles)
  return changed.filter((p) => named.has(p) || matches(p, testGlobs))
}

// The other half of the same rule, and the one that catches the interesting cheat: everything in
// the diff that is NOT test territory. If this is empty at RED time, there is nothing to
// implement and the "RED" is theatre; if a file appears in both lists, the policy's test globs
// are too wide and the replay would be carrying the implementation along with the tests.
export function implementationPatch({ changed, obligationFiles = [], testGlobs = [], matches }) {
  const test = new Set(testPatch({ changed, obligationFiles, testGlobs, matches }))
  return changed.filter((p) => !test.has(p))
}

// One criterion's RED, judged. `expected` comes from the obligation, so a criterion whose honest
// first failure is a missing export can say so instead of being forced to fake an assertion.
export function judgeRed({ obligation, result, classify }) {
  const label = obligation.selector ? `${obligation.file}::"${obligation.selector}"` : obligation.file
  const kind = classify(result.output)
  if (kind === "empty")
    return { ok: false, status: "NOT_EVALUATED", kind,
             reason: `${obligation.criterion} (${label}): the runner executed no matching test — a case that never ran is not RED` }
  if (result.code === 0)
    return { ok: false, status: "FAIL", kind: "passes",
             reason: `${obligation.criterion} (${label}) already passes at the base commit — nothing to implement against` }
  const expected = obligation.expected_red ?? obligation.expectedRed ?? "assertion"
  if (kind !== expected)
    return { ok: false, status: "NOT_EVALUATED", kind,
             reason: `${obligation.criterion} (${label}) failed as "${kind}", and this criterion declares its RED as "${expected}" — a broken harness is not a red test` }
  return { ok: true, status: "PASS", kind }
}

// And the mirror: the same criterion on the final tree. Exit 0 is necessary and not sufficient —
// a runner that matched nothing also exits 0, and "nothing ran" is not "it works".
export function judgeGreen({ obligation, result, classify }) {
  const label = obligation.selector ? `${obligation.file}::"${obligation.selector}"` : obligation.file
  const kind = classify(result.output)
  if (kind === "empty")
    return { ok: false, status: "NOT_EVALUATED", kind,
             reason: `${obligation.criterion} (${label}): the runner executed no matching test on the final tree` }
  if (result.code !== 0)
    return { ok: false, status: "FAIL", kind,
             reason: `${obligation.criterion} (${label}) does not pass on the final tree (${kind})` }
  return { ok: true, status: "PASS", kind }
}
