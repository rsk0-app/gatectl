# 02 — Development Lifecycle

## Feature states

```text
REQUESTED
DISCOVERING
NEEDS_CLARIFICATION
REQUIREMENTS_DEFINED
ARCHITECTURE_ANALYZED
RISKS_ANALYZED
SPEC_DRAFTED
SPEC_REVIEWING
SPEC_COMPLETE
SPEC_LOCKED
TEST_DESIGN
RED_CONFIRMED
READY_FOR_IMPLEMENTATION
IMPLEMENTING
GREEN_CONFIRMED
READY_FOR_VERIFICATION
VERIFYING
REWORK_REQUIRED
VERIFIED
REVIEWING
INTEGRATING
READY_FOR_PR
PR_OPEN
DONE
```

Failure / pause states:

```text
BLOCKED
PAUSED
FAILED
CANCELLED
NEEDS_HUMAN
```

## Development protocol

### 1. Request

Capture user intent without coding.

### 2. Discovery

Read-only agents inspect:

- repository structure
- architecture
- existing implementations
- tests
- git history
- ADRs
- dependencies
- security boundaries
- public API contracts
- data models

Before spec lock, repository access is read-only except `.spec/**`.

### 3. Requirement elicitation

Convert intent into explicit:

- actors
- flows
- success cases
- failure cases
- permissions
- constraints
- non-goals
- external dependencies
- operational expectations

### 4. Ambiguity + unknown analysis

Every important uncertainty becomes:

```text
KNOWN
INFERRED
ASSUMED
UNKNOWN
```

Blocking unknowns and ambiguities must be zero before spec lock.

### 5. Product + technical specification

Define:

- behavior
- architecture
- APIs
- state machines
- data
- security
- concurrency
- failure modes
- compatibility
- observability
- rollout
- rollback
- acceptance criteria

### 6. Adversarial spec review

A different model/provider attempts to break the spec.

Recommended:

```text
OpenAI drafts
Claude critiques
OpenAI resolves
```

### 7. Spec lock

Requirements:

- no blocking unknowns
- no blocking ambiguities
- no contradictions
- no unresolved critical/high security findings
- acceptance criteria complete
- important invariants testable
- rollout defined
- rollback defined

Locked spec receives:

```text
spec_version
spec_digest = SHA256(canonical specification)
```

### 8. Spec compilation

Generate:

- requirements graph
- invariant graph
- test obligations
- task DAG
- permissions
- reviewer requirements
- budgets
- done conditions

### 9. TDD design

Test agents may write tests but not production code.

Implementation remains locked.

Every important invariant maps to tests.

### 10. RED gate

Required:

```text
existing tests → PASS
new required tests → FAIL
failure reason → expected
```

Only then:

```text
RED_CONFIRMED
```

### 11. Implementation

Implementation agent gets:

- locked spec
- relevant task
- relevant tests
- allowed file scope
- budget
- architecture constraints

Acceptance tests remain read-only.

### 12. GREEN gate

Deterministic test execution proves required tests pass.

GREEN is necessary but not sufficient. It does not imply that every requirement was implemented or that the task is complete.

### 12.1 Completion candidate

The implementation worker submits a schema-valid completion candidate and transitions only to:

```text
READY_FOR_VERIFICATION
```

The candidate contains the locked spec digest, exact commit SHA, requirement claims, changed files, validation commands with exit codes, remaining work, blockers, deviations, and evidence references.

The worker is forbidden from returning `VERIFIED` or `DONE`. Empty remaining-work and blocker lists are claims to verify, not proof.

### 13. Validation swarm

Independent reviews may include:

- code review
- architecture review
- security review
- migration review
- API compatibility review
- simplicity review
- dependency review
- performance review

At least one required verifier must be independent from the implementation run. For high-risk work, use an opposite model provider where practical. A verifier receives the locked spec, repository state, diff, tests, and raw evidence—not the implementer's narrative alone.

### 14. Spec compliance

Trace:

```text
REQUEST
  ↓
REQUIREMENT
  ↓
INVARIANT
  ↓
TEST
  ↓
CODE
  ↓
EXECUTION EVIDENCE
```

No orphan nodes.

Requirements marked not applicable require an explicit approved waiver with owner, rationale, expiry or scope, and evidence. Silent omission is a failure.

### 14.1 Adversarial completion verification

The verifier actively attempts to falsify completion:

- remove or bypass behavior conceptually and confirm tests would catch it;
- inspect negative, failure, concurrency, authorization, compatibility, rollback, and observability paths;
- detect skipped, weakened, mocked-away, or newly rewritten acceptance tests;
- compare claimed scope against the actual diff;
- find requirements without code, tests, or fresh evidence;
- classify discovered gaps as `SPEC_GAP`, `IMPLEMENTATION_GAP`, `VERIFICATION_GAP`, or `NEW_SCOPE`.

Possible verifier decisions:

```text
VERIFIED
REWORK_REQUIRED
BLOCKED
NEEDS_HUMAN
```

### 14.2 Repair loop

`REWORK_REQUIRED` creates a bounded repair task referencing concrete finding IDs. The original implementer or a recovery agent may repair it. Verification must then run again on the new commit.

After `max_completion_repair_loops`, the controller enters `NEEDS_HUMAN`; it must not downgrade, waive, or hide findings automatically.

### 15. Integration

Merge isolated task branches, run full required suite, resolve conflicts.

### 16. PR

Draft PR includes objective, spec digest, implementation summary, tests, review results, risks, rollout, rollback, and evidence references.

### 17. Terminal completion

Only the Completion Authority may assign `DONE`. The decision is bound to exact digests. If the spec, commit, acceptance tests, dependency lockfiles, generated contracts, or decision-relevant configuration changes, prior verification becomes `STALE` and the relevant gates rerun.

`BLOCKED`, `PAUSED`, `PARTIAL`, `READY_FOR_VERIFICATION`, `PR_OPEN`, and `KNOWN_ISSUES` are not aliases for `DONE`.
