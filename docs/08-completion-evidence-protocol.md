# 08 — Completion & Evidence Protocol

## Purpose

Prevent an implementation agent from declaring success while requirements, edge cases, tests, or evidence are missing.

The protocol separates four different claims:

1. an agent run stopped;
2. code is green for the tests that ran;
3. the locked specification is independently verified;
4. the control plane authorizes a terminal state.

Only the fourth claim produces `DONE`.

## Authority model

| Actor | May produce | May not produce |
| --- | --- | --- |
| Implementer | code, local tests, completion candidate, `READY_FOR_VERIFICATION` | `VERIFIED`, `DONE`, self-waivers |
| Test agent | test obligations and tests | production implementation, completion decision |
| Independent verifier | verification report and findings | modify the candidate commit during verification |
| Adversarial verifier | falsification findings and gap classifications | silently expand scope |
| Human approver | explicit waiver or scope decision | retroactively alter immutable evidence |
| Completion Authority | deterministic `APPROVE` or `REJECT` | invent evidence or interpret missing fields optimistically |

Verifier independence means a different run ID, fresh context, no shared hidden scratchpad, and no authorship of the candidate implementation. High-risk policy may additionally require a different provider.

## Stable requirement registry

Every normative requirement receives a stable ID and:

- `priority`: `MUST`, `SHOULD`, or `MAY`;
- `applicability`: `APPLICABLE` or `NOT_APPLICABLE`;
- acceptance criteria;
- invariant and test obligations;
- required evidence types;
- owner and source.

A `MUST` requirement cannot disappear during compilation. `NOT_APPLICABLE` requires an approved waiver. Deleted or changed normative text creates a new spec version and digest.

## Traceability invariant

For every applicable `MUST` requirement:

```text
requirement
  → acceptance criterion
  → invariant
  → test obligation
  → executable test
  → implementation reference
  → execution evidence
  → verifier result
```

No empty edge and no orphan node are allowed. A passing suite cannot compensate for a missing requirement-to-test mapping.

## Completion candidate

The implementer emits `completion-candidate.yaml` using the schema. It is bound to:

- `feature_id` and `task_id`;
- locked `spec_digest`;
- exact `commit_sha`;
- implementer `run_id`;
- actual changed files;
- validation commands, exit codes, and output digests;
- requirement-by-requirement claims;
- remaining work, blockers, deviations, and scope changes.

The only successful candidate status is `READY_FOR_VERIFICATION`.

## Independent verification

The verifier starts from primary artifacts and must not trust the candidate summary. It:

1. verifies spec and commit identity;
2. reconstructs the requirement set from the locked spec;
3. checks applicability and waiver approvals;
4. compares the real diff with declared paths and scope;
5. verifies acceptance tests were not weakened;
6. reruns deterministic commands in a clean environment;
7. validates every traceability edge;
8. checks negative and failure paths;
9. validates evidence freshness;
10. emits a schema-valid report.

The verifier cannot edit the candidate commit. A required repair creates a new implementation attempt and commit, which requires fresh verification.

## Adversarial falsification

At least one pass asks “how could this be falsely green?” and checks:

- omitted requirement or acceptance criterion;
- tests that never reach production behavior;
- mocks that remove the required integration;
- `.skip`, `.only`, TODO, swallowed exceptions, vacuous assertions;
- unauthorized, duplicate, concurrent, slow, partial, retry, and out-of-order behavior;
- backward compatibility and unrequested behavior changes;
- observability, audit, rollout, rollback, and recovery claims;
- undeclared files, dependencies, configuration, generated contracts, and migrations.

## Gap classification

Every discovered omission has one type:

- `SPEC_GAP`: the locked spec was incomplete or contradictory. Reopen the spec and invalidate downstream evidence.
- `IMPLEMENTATION_GAP`: the spec was clear but code is missing or wrong. Create a repair task.
- `VERIFICATION_GAP`: existing verification failed to catch a defect. Add a regression obligation before repair.
- `NEW_SCOPE`: the request was introduced after lock. Create a separate change request.

Agents may recommend a type, but policy or an authorized human resolves disputed classification.

## Evidence record

Evidence is append-only and content-addressed. Every record carries:

- producer and run ID;
- creation time;
- spec, commit, test, dependency, configuration, and policy identities;
- command and environment identity where applicable;
- artifact digest and location;
- requirement/test references.

Logs without an exit code, commands without output identity, screenshots without environment identity, and narrative claims without primary artifacts do not satisfy deterministic gates.

## Freshness and invalidation

A verification decision is keyed by:

```text
feature_id
+ spec_digest
+ commit_sha
+ acceptance_test_digest
+ dependency_digest
+ generated_contract_digest
+ decision_configuration_digest
+ policy_version
```

Changing a key input marks affected evidence and reports `STALE`. The controller computes the smallest safe set of gates to rerun; it never silently reuses evidence for a different key.

## Repair loop

```text
READY_FOR_VERIFICATION
  → VERIFYING
  → VERIFIED
     or REWORK_REQUIRED → IMPLEMENTING → READY_FOR_VERIFICATION
     or BLOCKED
     or NEEDS_HUMAN
```

Each repair references finding IDs and increments `repair_loop`. On limit exhaustion:

- persist a checkpoint;
- preserve the branch and evidence;
- report unresolved findings;
- transition to `NEEDS_HUMAN`;
- prohibit automatic waiver or `DONE`.

## Completion decision

The Completion Authority accepts only schema-valid inputs. It approves when all policy predicates are true, including:

- 100% applicable `MUST` traceability;
- 100% required fresh evidence;
- all deterministic validations passed;
- independent verification passed;
- no unresolved blocking findings;
- no unapproved waivers;
- no undeclared scope changes;
- current digests match the report;
- required reviewers are independent.

Missing, unknown, stale, partial, blocked, skipped, or not-run values fail closed.

Reference decision order:

```text
if input schema invalid                 → REJECT
if decision key differs from evidence  → STALE
if repair loop limit exceeded          → NEEDS_HUMAN
if blocking finding exists             → REWORK_REQUIRED or BLOCKED
if waiver is missing approval          → REJECT
if MUST traceability is below 100%      → REWORK_REQUIRED
if required fresh evidence below 100%  → REWORK_REQUIRED
if deterministic validation failed     → REWORK_REQUIRED
if verifier independence failed        → REJECT
if declared and actual scope differ    → REWORK_REQUIRED
otherwise                              → APPROVE → DONE
```

## Audit events

Persist at least:

- `COMPLETION_CANDIDATE_SUBMITTED`;
- `VERIFICATION_STARTED`;
- `EVIDENCE_INVALIDATED`;
- `FINDING_OPENED` / `FINDING_RESOLVED`;
- `REWORK_REQUESTED`;
- `REPAIR_LIMIT_EXHAUSTED`;
- `COMPLETION_APPROVED` / `COMPLETION_REJECTED`;
- `FEATURE_DONE`.

Every terminal event references the decision key, input artifact digests, policy version, and actor.
