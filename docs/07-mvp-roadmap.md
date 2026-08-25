# 07 — MVP Roadmap

## Phase 0 — Protocol only

Implement schemas and repository conventions:

- feature spec format
- unknown/assumption format
- task contract
- agent budget
- checkpoint contract
- requirement → test traceability

## Phase 1 — Spec pipeline

Implement:

1. request capture
2. read-only discovery
3. OpenAI spec draft
4. Claude spec critique
5. clarification packet
6. spec completeness gate
7. spec digest / lock

Do not implement autonomous coding yet.

## Phase 2 — TDD compiler

Implement:

1. invariant extraction
2. acceptance criteria compiler
3. test obligation generation
4. test agent permissions
5. RED verification
6. test review

## Phase 3 — Bounded coding workers

Implement:

- Scheduler
- Execution Controller
- Herdr integration
- Claude Code runner
- Codex runner
- git worktrees
- scoped file permissions
- turn/time/cost limits
- checkpoints
- pause/resume
- no-progress detection

## Phase 4 — Review + integration

Implement:

- cross-provider review
- architecture guardian
- simplicity guardian
- security guardian
- integration agent
- GREEN gate
- evidence bundle
- completion candidate contract
- independent completion verifier
- deterministic Completion Authority
- draft PR

## Phase 5 — Monster mode

Add:

- risk-based autonomy
- migration guardian
- API guardian
- historical bug miner
- ADR reader
- capability detection
- dependency guardian
- performance gate
- chaos/failure tests
- mutation testing
- model performance/reputation routing
- task preemption
- recovery agent
- institutional memory
- spec drift detection
- event sourcing

## Recommended MVP flow

```text
User request
  ↓
OpenAI spec
  ↓
Claude critique
  ↓
resolve questions
  ↓
SPEC LOCK
  ↓
Claude Code creates tests
  ↓
Codex reviews tests
  ↓
RED
  ↓
task DAG
  ↓
Claude Code / Codex implementation
  ↓
soft-limit checkpoints / pause / resume
  ↓
GREEN
  ↓
opposite-provider review
  ↓
spec compliance
  ↓
draft PR
```

## MVP default limits

```yaml
max_turns: 30
max_wall_clock: 15m
max_cost_usd: 5
checkpoint_every_turns: 10
max_review_loops: 3
no_progress_turns: 8
global_agents: 5
max_agents_per_project: 3
max_agents_per_feature: 2
```

## Recommended first implementation target

Build one end-to-end feature against a small TypeScript repository and require the system to:

1. discover the repo
2. produce a locked spec
3. generate failing acceptance tests
4. run exactly one coding agent
5. checkpoint at soft limit
6. resume if necessary
7. pass GREEN
8. get opposite-provider review
9. create evidence bundle
10. submit `READY_FOR_VERIFICATION`
11. independently verify exact spec + commit
12. authorize completion deterministically
13. open draft PR

Do not start with a swarm.
