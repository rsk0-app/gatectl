# 05 — Quality Gates

## G0 Requirements Gate

Requires:

- actors defined
- flows defined
- success/failure behavior defined
- non-goals defined
- blocking unknowns = 0

## G1 Architecture Gate

Requires:

- relevant architecture mapped
- existing conventions understood
- ADR conflicts resolved
- blast radius analyzed

## G2 Spec Completeness Gate

Requires:

```yaml
blocking_unknowns: 0
blocking_ambiguities: 0
contradictions: 0
critical_security_findings: 0
high_security_findings: 0
acceptance_coverage: 100%
important_invariant_testability: 100%
rollout_defined: true
rollback_defined: true
```

## G3 Test Design Gate

Every required invariant must map to test obligations.

No orphan requirement.

## G4 RED Gate

```text
existing tests PASS
new required tests FAIL
failure reason matches missing behavior
```

## G5 Implementation Gate

Production write capability exists only if:

```text
SPEC_LOCKED
AND RED_CONFIRMED
```

## G6 GREEN Gate

All task-required deterministic tests pass.

## G7 Review Gate

No critical/high unresolved required-review findings.

## G8 Security Gate

Mandatory where security policy triggers.

## G9 Operability Gate

Required logs, metrics, audit behavior, runbooks, and rollback/verification steps exist where applicable.

## G10 Spec Compliance Gate

All required paths trace:

```text
requirement → invariant → test → code → evidence
```

## G11 Integration Gate

Integrated branch passes required full-suite validation.

## G12 Completion Candidate Gate

Requires a schema-valid implementer report bound to the current locked spec and commit. The only successful implementer status is `READY_FOR_VERIFICATION`.

## G13 Independent Verification Gate

Requires:

```yaml
independent_from_implementation_run: true
spec_digest_matches: true
commit_sha_matches: true
traceability_coverage_percent: 100
must_requirements_verified_percent: 100
required_evidence_fresh_percent: 100
unresolved_blocking_findings: 0
unapproved_waivers: 0
undeclared_scope_changes: 0
deterministic_validations_passed: true
acceptance_tests_unchanged_or_approved: true
```

## G14 PR Gate

PR cannot open until required gates pass.

## G15 Completion Authority Gate

The deterministic Completion Authority evaluates all previous gates and the verification report. Models cannot bypass this gate or directly write `DONE`.

The decision key is:

```text
feature_id + spec_digest + commit_sha + test_digest + policy_version
```

Any change to a key component invalidates the decision.

## Definition of Ready

A feature is ready for implementation only if:

- product semantics are understood
- blocking unknowns resolved
- architecture approach defined
- blast radius understood
- security impact understood
- data impact understood
- failure behavior defined
- compatibility expectations defined
- observability defined
- rollout defined
- rollback defined
- acceptance criteria executable
- tests designed
- RED confirmed

## Definition of Done

A feature is done only if:

- all requirements traced
- all required tests pass
- all invariants verified
- no blocking review findings
- no scope violations
- no unresolved spec drift
- rollback remains valid
- required docs completed
- evidence bundle generated
- PR created
- independent completion verification passed
- completion evidence is fresh for the exact decision key
- Completion Authority approved the terminal transition

## Gap taxonomy

| Type | Meaning | Required action |
| --- | --- | --- |
| `SPEC_GAP` | Necessary behavior was absent or contradictory in the locked spec | Reopen/version the spec; invalidate downstream evidence |
| `IMPLEMENTATION_GAP` | Locked requirement was not correctly implemented | Create bounded repair task and reverify |
| `VERIFICATION_GAP` | Existing checks failed to detect an implementation defect | Add regression obligation, repair, and reverify |
| `NEW_SCOPE` | Newly requested behavior is outside the locked spec | Create a separate change request |
