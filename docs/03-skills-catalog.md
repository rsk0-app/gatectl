# 03 — Skills Catalog

Skills are reusable capabilities with explicit inputs, outputs, permissions, and completion criteria.

## Mandatory pre-development skills

### requirement-elicitation
Turns vague intent into explicit actors, flows, success/failure behavior, constraints, permissions, dependencies, and non-goals.

### ambiguity-hunter
Finds materially vague statements and converts them into blocking questions.

### missing-requirements-detector
Detects absent requirements such as authorization, retries, idempotency, pagination, retention, compatibility, error semantics, concurrency, and audit behavior.

### codebase-archaeologist
Maps relevant modules, entry points, domain models, abstractions, tests, and similar existing features.

### convention-detector
Finds naming, validation, logging, repository, testing, dependency injection, and configuration conventions.

### architecture-mapper
Creates a dependency graph around the proposed change.

### change-impact-analyzer
Estimates direct, indirect, external, data, CI, runtime, SDK, event, and deployment blast radius.

### dependency-risk-analyzer
Checks necessity, alternatives, license, maintenance, security, runtime cost, compatibility, and lock-in.

### api-contract-analyst
Classifies API changes as NON_BREAKING / BEHAVIOR_CHANGE / BREAKING.

### schema-compatibility-analyst
Analyzes compatibility for JSON, GraphQL, protobuf, Avro, DB schemas, events, and configuration.

### data-impact-analyst
Defines persistence impact, migrations, indexes, backfill, locking, retention, PII classification, and rollback.

### migration-planner
Prefers expand → compatible deploy → backfill → verify → contract.

### concurrency-analyst
Checks races, duplicate work, lost updates, ordering, deadlocks, idempotency, and distributed locking.

### failure-mode-analyst
For each dependency/component asks what happens on failure, slowness, partial success, malformed response, duplicate response, and retry.

### security-threat-modeler
Checks authn/authz, credentials, privilege escalation, injection, SSRF, CSRF, replay, session fixation, data exposure, logs, abuse, and rate limiting.

### trust-boundary-mapper
Defines trusted/untrusted boundaries between clients, services, networks, and storage.

### permissions-analyst
Defines who can perform what operation on which resource under which tenant/scope/conditions.

### privacy-analyst
Defines collected data, purpose, retention, access, deletion, logging exposure, and third-party transfer.

### observability-designer
Defines required logs, metrics, traces, events, dashboards, alerts, audit events, correlation IDs, and forbidden sensitive log fields.

### slo-impact-analyst
Checks latency, availability, throughput, resource use, and error-budget impact.

### performance-analyst
Analyzes complexity, query count, payload size, N+1 risk, memory, CPU, and caching.

### capacity-analyst
Estimates users, RPS, events/sec, storage growth, queue depth, and worker concurrency.

### rollout-designer
Selects direct, feature flag, canary, percentage, tenant, region, or shadow rollout.

### rollback-designer
Defines code rollback, schema compatibility, config rollback, feature flags, and irreversible effects.

### recovery-designer
Defines retry, repair job, reconciliation, and manual recovery after partial failure.

### testability-analyst
Rejects requirements that cannot be observed/tested.

### acceptance-criteria-compiler
Turns requirements into executable Given/When/Then-like conditions.

### edge-case-generator
Generates null, empty, min/max, malformed, unauthorized, expired, duplicate, concurrent, partial, slow, retry, out-of-order, and dependency-failure cases.

### state-machine-extractor
Defines states and legal transitions.

### invariant-extractor
Produces invariants that must always hold.

### regression-mapper
Maps existing behavior that must remain unchanged.

### historical-bug-miner
Searches git history, issues, PR reviews, TODOs, incidents, and test history for past failures.

### git-history-analyst
Uses history/blame to distinguish accidental complexity from deliberate compatibility.

### adr-reader
Checks relevant architecture decisions and raises ADR change requests where needed.

### existing-capability-detector
Searches for functionality that already exists before inventing new abstractions.

### simplification-critic
Asks whether the same spec can be satisfied with materially less code or infrastructure.

### overengineering-detector
Flags unnecessary services, abstractions, queues, tables, dependencies, and agent roles.

### spec-contradiction-detector
Checks product vs technical spec, ADRs, contracts, policies, and requirements for contradictions.

### unknowns-tracker
Maintains blocking and non-blocking unknowns.

### evidence-collector
Requires important claims to reference source evidence where possible.

## TDD skills

### test-plan-compiler
Maps requirements/invariants to required test obligations.

### test-author
Writes tests before production implementation.

### test-reviewer
Checks whether tests actually exercise production behavior and would fail if behavior were removed.

### property-test-designer
Creates property-based tests for suitable invariants.

### mutation-test-planner
Uses mutation testing selectively to detect weak tests.

### anti-cheating-test-reviewer
Rejects `.skip`, `.only`, TODO tests, fake assertions, catch-and-ignore, and tests that mock away the behavior under test.

## Implementation skills

### task-sizer
Splits work into bounded agent slices.

### file-ownership-planner
Assigns owned paths and minimizes parallel write conflicts.

### implementation-agent
Implements only the assigned task and allowed scope.

### integration-agent
Merges task branches and runs integration validation.

### recovery-agent
Takes over stuck work from a structured checkpoint.

## Review skills

### cross-model-code-reviewer
Uses the opposite provider from the implementation agent where practical.

### architecture-guardian
Checks dependency direction, layering, domain boundaries, forbidden coupling, and duplication.

### simplicity-guardian
Checks whether implementation is unnecessarily complex.

### security-guardian
Mandatory for sensitive paths such as auth, permissions, crypto, payments, infra, and secrets.

### migration-guardian
Mandatory on schema or migration changes.

### public-api-guardian
Mandatory on OpenAPI, GraphQL, SDK, events, protobuf, or public exports.

### dependency-guardian
Reviews newly introduced dependencies.

### behavior-differential-reviewer
Compares intended before/after semantics and finds unrequested behavior changes.

### spec-compliance-reviewer
Verifies every required behavior has test and code evidence.

### completion-candidate-reporter
Produces a schema-valid `READY_FOR_VERIFICATION` report bound to the locked spec digest and exact commit SHA. It cannot declare `VERIFIED` or `DONE`.

### independent-completion-verifier
Reconstructs requirement coverage from primary artifacts, reruns required deterministic checks, validates evidence freshness, and returns only `VERIFIED`, `REWORK_REQUIRED`, `BLOCKED`, or `NEEDS_HUMAN`.

### adversarial-completion-reviewer
Attempts to disprove completeness using negative paths, omitted requirements, test weakening, scope drift, failure modes, concurrency, authorization, rollback, and operability checks.

### gap-classifier
Classifies a discovered omission as `SPEC_GAP`, `IMPLEMENTATION_GAP`, `VERIFICATION_GAP`, or `NEW_SCOPE`, preventing new requests from being silently folded into an already locked task.

### evidence-freshness-checker
Invalidates evidence when its spec digest, commit SHA, test digest, dependency digest, configuration digest, command, or environment does not match the completion decision inputs.

## Non-LLM completion capability

### completion-authority
Deterministic policy code that evaluates schema-valid reports and gates. This is deliberately not an agent skill. It alone writes terminal completion states.
