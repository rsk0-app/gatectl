# Executable invariants and multiple checks per requirement

Status: proposed design; no runtime support is claimed by this document.

Reference implementation: gatectl 0.16.3, commit
`df0e79d168f74fb7ca59a03f143013b9a7de5918`.

## Problem and outcome

This document calls the combined workflow **Spec-Driven TDD (SD-TDD)**:
specification -> acceptance criteria -> tests -> implementation -> verification.
The name describes this project's workflow; it is not a claim of an industry
standard. The specification defines the behavior, and executable obligations
connect that behavior to the TDD and preservation experiments below.

Large projects need evidence for both the behavior a change introduces and the
behavior it must preserve. The current compiler creates one test obligation per
acceptance criterion from its singular `test` field. Invariants contain an ID and
statement and are covered by Gate X's model review, but do not become executable
test obligations. Completion indexes results by criterion ID and requires RED and
GREEN when the effective policy requires R.

This is useful for a new feature or bug fix, but cannot explicitly demonstrate
that an existing invariant passed before and after a refactor. One test reference
also cannot require a unit test and an integration test for the same promise.

The proposed outcome is a versioned obligations manifest in which every declared
check has its own identity, evidence and outcome. Completion must distinguish
new behavior proven RED -> GREEN, preserved behavior checked GREEN -> GREEN, and
requirements supported only by review. These are different claims.

Implementation reference points:

- [Spec compiler](../../src/core/spec-compile.mjs)
- [Baseline replay and result classification](../../src/core/replay.mjs)
- [Gate decisions](../../src/core/gates.mjs)
- [Completion authority](../../src/core/completion.mjs)
- [Review coverage](../../src/core/review.mjs)
- [CLI orchestration](../../src/cli/commands.mjs)

## Scope

1. A version 2 spec format with multiple required checks per target.
2. Executable preservation invariants and explicit change/preservation proof modes.
3. Baseline replay, final checks, evidence binding, review and completion for those
   obligations, including preservation-only refactors.
4. Backward compatibility, migration diagnostics and adversarial regression tests.

This change does not implement a project-wide contract registry, dependency graph,
mutation testing, agent scheduler, sandbox or full independent CI re-evaluation.
Those are separate follow-ups. It does not change default workflows in existing
repositories or require another model invocation for each individual check.

## Proposed spec format

The following is a future-format example, not a spec that 0.16.3 can execute:

```yaml
schema_version: 2
id: release-correlation
state: DRAFT
mvp_ref: maintenance
intent: Correlate deployment events with degradation while preserving tenant isolation.

invariants:
  - id: INV-01
    statement: A tenant cannot read another tenant's releases.
    proof: preserve
    checks:
      - id: CHK-01
        file: test/tenant-isolation.integration.test.ts
        selector: denies cross-tenant release access
        level: integration
  - id: INV-02
    statement: The correlation module retains its documented ownership boundary.
    proof: review
    reason: Architecture ownership is assessed by the reviewer and is not an executable claim.

acceptance_criteria:
  - id: AC-01
    statement: A deployment and a degradation inside the configured window are correlated.
    proof: change
    checks:
      - id: CHK-01
        file: test/correlation.test.ts
        selector: correlates a deployment inside the window
        level: unit
        expected_red: assertion
      - id: CHK-02
        file: test/correlation.integration.test.ts
        selector: exposes the correlated release through the API
        level: integration
        expected_red: assertion

allowed_paths:
  - src/correlation/**
  - test/**
rollback:
  strategy: Disable the correlation feature flag and revert the implementation.
blocking_questions: []
```

### Validation and identity

- Specs without `schema_version` are version 1. Their singular `test`, compiled
  representation, digest and evidence interpretation remain unchanged. A new
  engine also accepts explicit version 1 using the same compiled representation.
- Version 2 uses `checks`; mixing `test` and `checks`, an unknown version or proof
  mode, or an unknown key inside a check is an error, never an ignored obligation.
- Acceptance criteria use `proof: change` or `proof: preserve`. Invariants use
  `proof: preserve` or `proof: review`. Every version 2 target declares its mode;
  absence is an error. An invariant being repaired is represented by a change
  criterion until a passing baseline exists; it cannot falsely claim preservation.
- `change` and `preserve` require a non-empty list of checks. `review` forbids
  checks and requires a non-empty `reason`. Policy-only acceptance criteria may
  use `review` only under the policy-only rules below.
- Each check requires `id`, `file` and a non-empty `selector`. IDs use
  `CHK-` followed by two or three digits and are unique within their target.
  Target IDs retain the current uniqueness rules. Stable obligation identity is
  `(spec.id, target.id, check.id)`, never the array position or target ID alone.
- Reusing the same `(file, selector)` within a spec is rejected, retaining the
  current prohibition on counting one named case as several independent proofs.
  A file may contain several distinct named cases.
- `level` is optional metadata with values `unit`, `integration`, `contract` or
  `e2e`. It selects neither a command nor a proof strength. Commands remain in the
  owner's policy; inline executable commands in a spec are not introduced.
- `expected_red` is valid only for `change`, defaults to `assertion`, and supports
  the current explicit `load` case. It is rejected for preservation checks.
- Version 2 canonicalization sorts targets and checks by ID. Reordering these
  lists does not change their digest. Any semantic field change, including proof
  mode, reason, check identity, selector, level or expected RED, changes the digest.
  The version 1 canonicalization algorithm must not be modified.

## Proof semantics

| Mode | Baseline experiment | Final candidate | Completion claim |
| --- | --- | --- | --- |
| `change` | Named check fails for its declared expected RED reason | Same check passes | `change_red_green` |
| `preserve` | Named check passes | Same check passes | `preservation_green_green` |
| `review` | No executable claim | Existing review obligations apply | `review_only` |

All checks in a target are required: aggregation is AND. One unit test cannot
compensate for a missing integration test. A full-suite receipt is not evidence
for a different named-check invocation. Existing command receipt reuse remains
allowed only when expanded command, candidate and execution inputs match.

The proof mode is part of the locked spec and review input. Switching `change` to
`preserve`, removing a check or moving a target to `review` invalidates the lock,
baseline, final and review evidence. The reviewer must see these obligation
changes. The tool cannot prove from prose that a mode was chosen honestly; spec
review remains responsible for that judgment. A green baseline must never cause
automatic reclassification of a failed change obligation as preservation.

### Replay and classification

Resolve one explicit base commit for the feature's baseline manifest; mixed base
commits cannot satisfy it. Run both modes in the existing disposable worktree
model: base commit plus the proposed test patch, without candidate implementation
changes. This permits characterization tests to be added before refactoring.

The replay must record the exact overlay paths and digest. Necessary fixtures or
test setup may be included only through paths explicitly authorized by the trusted
policy. If a check needs a candidate-only production helper to pass at baseline,
report the replay as not evaluable; do not copy that helper into the baseline.
These path rules do not make test code trustworthy or create a sandbox.

For preservation, an executed check failing a behavioral assertion is FAIL; a
load error, unavailable dependency/service, empty or skipped selection, timeout,
or unclassifiable runner outcome is NOT_EVALUATED. For change, retain the existing
expected-RED rules, including explicitly declared load failures. For both modes,
an empty or skipped selection is never evidence of execution or success.

If the runner cannot establish that the selected check executed, answer
NOT_EVALUATED rather than inferring success from exit 0 alone. Runner adapters may
provide structured results; a selector's text is not proof of exact selection.
Unknown infrastructure failures must not be counted as intentional RED.

Final GREEN requires every executable obligation to pass on the actual candidate
tree. A behavioral failure is FAIL; unavailable execution is NOT_EVALUATED. The
current working-tree/index consistency check still applies. Replay must leave the
user's checkout and index unchanged and clean up its temporary worktree on failure.

## CLI, gates and workflows

Add `gatectl test-baseline --base <sha>` as the neutral entry point for version 2:
it runs every declared baseline obligation and records separate R (change) and P
(preservation) results. No synthetic RED result is written for preservation.
Retain `test-red`/`red` for version 1 and for the change subset in version 2; invoking
it on a preservation-only spec reports not applicable and points to test-baseline
without writing a PASS record.

Extend `test-green`, `check`, `next --json`, `ready-to-commit` and `finish` to consume
the same versioned manifest:

- Version 1 follows exactly its existing effective requirements.
- In version 2, declared change checks require R plus final GREEN, and declared
  preservation checks require P plus final GREEN, even when fast workflow or a
  lower tier would otherwise omit criterion proof. Explicit obligations strengthen
  the workflow; fast mode does not silently discard them.
- For version 2, a policy requirement R means executable baseline proof. A
  preservation-only spec satisfies that requirement through P, records that no RED
  was claimed, and still requires final GREEN. Mixed specs require both R and P.
  A spec with no executable obligations cannot satisfy a tier requiring R.
- Existing non-R tier requirements, critique, scope checks, metadata protection
  and Gate X requirements are retained. This adds P to the engine's supported gate
  vocabulary without requiring an existing policy file to be rewritten.
- `next` requests missing/stale baseline evidence before implementation; `check`
  evaluates final obligations in addition to its existing configured checks.
  Both commit readiness and completion reject missing or stale child results.
- `check-related` remains an editing aid and does not satisfy the full manifest.
  Readiness and finish remain read-only with respect to running tests or models.
- `verification: policy` may allow explicitly review-only acceptance criteria only
  when the effective tier permits policy-only work. It cannot waive executable
  obligations declared elsewhere in the same spec or an effective R requirement.

Unchanged version 1 fast repositories incur no new baseline step. Choosing version
2 with executable proof modes is an explicit opt-in to these stronger obligations;
setup and migration must explain the additional work before writing new specs.

## Evidence, review and completion

Version 2 evidence includes the manifest version and an entry keyed by each full
obligation identity. Record target kind, proof mode, test identity, spec and policy
digests, test/support-input digest, resolved base commit, replay-tree identity,
expanded command, execution context, phase and classified outcome. Final evidence
also binds the candidate tree. Reuse the existing authenticated ledger and receipt
mechanisms instead of introducing a second evidence store.

Baseline evidence survives implementation-only changes but becomes stale when its
spec, required test/support bytes, baseline, policy or captured execution inputs
change. Final evidence becomes stale when the candidate changes. Changed external
inputs require a fresh run, as they do today; neither metadata nor signatures prove
that a remote service stayed unchanged. Later failed or not-evaluated attempts
supersede earlier successes for the same obligation and phase.

Version 1 results cannot be expanded into several version 2 child results. Missing,
duplicate, malformed, unexpected-mode or mixed-base entries cannot satisfy the
manifest. The completion authority must not collapse child results into a map
keyed only by AC or INV ID. Accept only an exact set of required check identities
with valid phase evidence, plus all existing required gates and attestation checks.

Gate X continues to address every criterion and invariant with verified citations.
Its input additionally contains proof modes, check mappings, current result
summaries and any obligation changes since the previous lock/review. A reviewer
can question whether tests assert the requirement, but cannot replace missing
execution evidence or turn a failed check into PASS.

For version 2, completion uses `basis: obligation_evidence` whenever executable
obligations exist, listing `change_red_green`, `preservation_green_green` and
`review_only` target/check identities separately. A policy-only completion with no
executable obligations retains `basis: policy_gates`. Explicitly label whether
review-only targets were reviewed under policy or no review was required; never
report unrequired review as performed. Version 1 completion labels stay unchanged.

Human and JSON output must identify target, check, phase, actual outcome, missing
predicate and next command. Partial success is visible without implying target
completion. Exit codes remain 0 PASS, 1 FAIL and 2 NOT_EVALUATED; mixed execution
outcomes retain the current FAIL-over-NOT_EVALUATED aggregation. Readiness and
completion return rejection when required evidence is absent, naming its cause.

## Compatibility and rollout

0.16.3 does not enforce a schema-version field and may ignore unknown fields in
some shapes. Adding `schema_version: 2` alone cannot protect users of old binaries.
Do not claim that an unmodified old engine safely rejects every future spec.

1. First ship explicit schema-version validation and a guard rejecting unsupported
   versions. Add version 1 compatibility fixtures pinning current canonical bytes,
   digests, command behavior and completion labels. This preparatory release still
   rejects version 2.
2. Implement version 2 compilation, typed obligations and result classification.
3. Implement replay, evidence binding, effective requirements, review, next and
   completion together before enabling version 2 creation in templates/plugins.
4. Update and verify all execution entry points, including installed plugins and
   any pinned CI verifier, before a repository adopts version 2. An old verifier
   must not be presented as confirming the new proof semantics. Independent full
   CI re-evaluation remains outside this change.
5. Migration is explicit and shows the proposed spec diff. Convert each legacy AC
   test to `CHK-01` with `proof: change`. Require an explicit choice for each
   invariant: executable preservation with named checks, or review with a reason.
   Do not invent preservation tests or silently promote historical review to proof.
6. Migration re-locks the spec and obtains fresh evidence. No automatic conversion
   of signed results, rewriting of policy, or modification of unrelated ACTIVE work.

Rollback keeps immutable history and evidence. Use a compatible engine to finish
or pause active version 2 work. Returning to version 1 requires an explicit spec
conversion and fresh evidence under its weaker/smaller obligations; losing an
invariant test or an additional check must be disclosed. An old binary is not a
valid verifier for retained version 2 acceptance claims.

## Acceptance criteria and verification plan

These criteria govern the future implementation, not the completion of this
documentation PR. Test names describe intended cases; the tests do not exist yet.
Build them with SDD -> TDD in the staged implementation PRs. Use temporary target
repositories and deterministic fake runners for classification/identity tests,
plus real runner end-to-end cases for selection and replay behavior.

| ID | Required behavior / negative case | Planned test location |
| --- | --- | --- |
| AC-01 | Existing version 1 specs retain byte-identical compiled output/digests, legacy singular tests and prior workflow/completion behavior. | `test/spec-compile.test.mjs`, `test/workflow-fast.test.mjs`, `test/completion.test.mjs` |
| AC-02 | Reject unsupported versions, mixed field formats, unknown check keys, duplicate target/check identities, duplicate named test references and empty check lists. Distinct checks in one file remain valid. | `test/spec-compile.test.mjs` |
| AC-03 | Reordering version 2 targets/checks preserves digest and identity; changing/removing a check or changing proof mode invalidates evidence. | `test/spec-compile.test.mjs`, `test/gate-c.test.mjs` |
| AC-04 | One criterion with two checks cannot complete when either check is absent, failed, skipped or stale. Both passing with valid baselines can complete. | `test/completion.test.mjs`, `test/e2e-cli.test.mjs` |
| AC-05 | A change check must fail for its declared expected reason on the replay and pass finally. A passing baseline is rejected without automatic conversion to preservation. | `test/gate-r.test.mjs`, `test/replay.test.mjs` |
| AC-06 | Preservation succeeds only with passing baseline and final results; a baseline assertion failure is FAIL, a load failure is NOT_EVALUATED. Characterization tests may be introduced in the authorized test overlay. | `test/preservation.test.mjs` (new), `test/replay.test.mjs` |
| AC-07 | A preservation-only refactor can complete under a tier requiring R through P and final GREEN, retaining all other gates and never claiming RED. A mixed spec requires both modes. | `test/preservation.test.mjs` (new), `test/next.test.mjs`, `test/completion.test.mjs` |
| AC-08 | Empty, skipped, timed-out, unavailable and unclassifiable runs never supply a successful child result. Exact command receipts cannot stand in for different selectors. | `test/preservation.test.mjs` (new), `test/execution-context.test.mjs`, `test/e2e-cli.test.mjs` |
| AC-09 | Candidate production changes cannot enter the baseline through the replay overlay. Unsupported test setup refuses evaluation; replay failure preserves the original checkout and index. | `test/replay.test.mjs`, `test/attack.test.mjs` |
| AC-10 | Changed tests/support inputs, policy, base or execution context stale baseline evidence; implementation-only changes preserve baseline but stale final evidence. | `test/gate-c.test.mjs`, `test/execution-context.test.mjs` |
| AC-11 | Reject duplicate, missing, mixed-base, wrong-mode and legacy-as-child evidence. A later failed/NOT_EVALUATED attempt supersedes an earlier success. | `test/completion.test.mjs`, `test/attack.test.mjs` |
| AC-12 | Gate X receives mode/check changes, still covers all AC/INV IDs and validates citations; model approval cannot replace missing executable evidence. | `test/gate-x.test.mjs`, `test/completion.test.mjs` |
| AC-13 | Fast/policy-only settings cannot skip declared version 2 executable obligations or satisfy an R tier with only review. Existing version 1 fast behavior stays unchanged. | `test/workflow-fast.test.mjs`, `test/next.test.mjs` |
| AC-14 | Readiness, finish and JSON diagnostics name individual missing predicates and accurate proof bases, without launching commands/models. | `test/next.test.mjs`, `test/completion.test.mjs`, `test/e2e-cli.test.mjs` |
| AC-15 | Migration requires invariant choices, invalidates old evidence, preserves unrelated ACTIVE work and does not edit policy; packaged CLI/plugins agree on schema support. | `test/cli-smoke.test.mjs`, `test/plugin.test.mjs`, `test/release-version.test.mjs` |

## Follow-ups and limits

After these obligations work end to end, separately specify a local registry of
persistent project contracts, bounded mutation testing of critical changed code,
and stronger independently issued CI evidence. A dependency service outage must
not become an accidental requirement for local gating.

GREEN -> GREEN demonstrates preservation of the observed tests, not equivalence
of all behavior. RED -> GREEN does not establish test quality or specification
completeness. Review mode is a model judgment, not executed proof. The existing
local-key, command-trust, external-input and sandbox limitations still apply.

The design is ready for review, not an accepted spec lock. Review should focus on
the explicit R-to-P semantics for preservation-only work, proof-mode downgrade
visibility, replay fixture boundaries and safe adoption across old clients.
