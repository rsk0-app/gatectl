# 01 — Architecture

## Goal

Build an autonomous software engineering control plane where AI agents are replaceable workers and the development protocol is deterministic, inspectable, recoverable, and policy-governed.

## Top-level architecture

```text
                           USER
                            │
                            ▼
                     FEATURE REQUEST
                            │
                            ▼
                 PRE-DEVELOPMENT ENGINE
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
 Codebase Scout       Security Scout        Test Scout
       │                    │                    │
       └──────────────┬─────┴─────┬──────────────┘
                      ▼           ▼
                Impact Analysis  Unknowns
                      │           │
                      └─────┬─────┘
                            ▼
                       SPEC ENGINE
                   OpenAI ⇄ Claude
                            │
                            ▼
                   COMPLETENESS GATE
                            │
                            ▼
                       SPEC LOCK
                            │
                            ▼
                     SPEC COMPILER
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
  TEST OBLIGATIONS       TASK DAG        PERMISSIONS
          │
          ▼
      TDD ENGINE
   Claude ⇄ OpenAI
          │
          ▼
       RED GATE
          │
          ▼
       SCHEDULER
          │
          ▼
   EXECUTION CONTROLLER
 budgets / slices / pause
 resume / progress / cost
          │
          ▼
         HERDR
     ┌────┼────┐
     ▼    ▼    ▼
  Claude Codex Claude
     │    │    │
     ▼    ▼    ▼
   isolated git worktrees
          │
          ▼
        GREEN
          │
          ▼
 READY_FOR_VERIFICATION
          │
          ▼
    VALIDATION SWARM
  Architecture / Security /
  Simplicity / API / Migration
          │
          ▼
    SPEC COMPLIANCE
          │
          ▼
 ADVERSARIAL VERIFIER
          │
          ▼
 COMPLETION AUTHORITY
          │
          ▼
     EVIDENCE BUNDLE
          │
          ▼
          PR
```

## Core components

### Control Plane

Owns:

- projects
- repositories
- features
- spec versions
- requirements
- invariants
- task graphs
- agent runs
- budgets
- checkpoints
- reviews
- findings
- approvals
- evidence
- event log

### Spec Engine

Produces and reviews:

- product specification
- technical specification
- invariants
- acceptance criteria
- unknowns
- assumptions
- risks
- rollout
- rollback
- observability requirements

### Spec Compiler

Transforms a locked specification into:

- requirement graph
- test obligations
- task DAG
- permissions
- execution budgets
- mandatory reviewers
- done conditions

### Scheduler

Schedules bounded units of work based on:

- dependencies
- priority
- agent slots
- project limits
- risk
- budget
- file-conflict probability

### Execution Controller

Controls each running coding agent:

- wall-clock limits
- turn limits
- token limits
- cost limits
- tool-call limits
- file-change limits
- progress checkpoints
- pause/resume
- preemption
- no-progress detection
- hard termination

### Herdr

Runtime for persistent coding-agent terminal sessions.

Herdr is not the source of truth. It is the process/session runtime.

### Git

Each task runs in an isolated worktree and branch.

### Policy Engine

Deterministically decides:

- can spec lock?
- can tests start?
- can agent receive write permission?
- can agent continue?
- can integration start?
- can PR open?
- can a task become VERIFIED?
- can a feature become DONE?

LLMs cannot override policy.

### Completion Authority

The Completion Authority is deterministic control-plane code, not an LLM role.

It alone may transition a task to `VERIFIED` and a feature to `DONE`. It evaluates:

- locked `spec_digest` and current `commit_sha`;
- requirement traceability and approved applicability decisions;
- deterministic validation results and exit codes;
- independent verification reports;
- unresolved findings, blockers, waivers, and scope changes;
- evidence freshness and required review separation.

Implementers, reviewers, and model providers submit signed or hashed claims and evidence. They never self-approve completion.

## State ownership

```text
PostgreSQL → workflow state
Git        → code state
Spec repo  → requirements state
CI         → test evidence
Herdr      → runtime session state
Completion Authority → terminal task/feature status
```

## Foundational principle

Agents are workers, not databases, schedulers, or policy authorities.
