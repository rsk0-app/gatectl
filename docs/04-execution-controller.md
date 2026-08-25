# 04 — Execution Controller

The Execution Controller sits between the Scheduler and Herdr.

```text
Scheduler
   ↓
Execution Controller
   ↓
Herdr
   ↓
Claude Code / Codex
```

## Execution budget

Every agent run receives:

```yaml
wall_clock:
  soft: 15m
  hard: 30m

turns:
  soft: 40
  hard: 60

tokens:
  soft: 100000
  hard: 150000

cost_usd:
  soft: 5
  hard: 8

tool_calls:
  soft: 100
  hard: 150

files_changed:
  soft: 10
  hard: 20
```

## Soft limit

Do not kill immediately.

Send checkpoint instruction:

```text
Stop starting new work.
Summarize:
- completed work
- current state
- remaining work
- blockers
- changed files
- test status
- spec conflicts
- next recommended action
Then enter PAUSED.
```

## Hard limit

The controller must:

1. interrupt/terminate the run;
2. capture git status and diff;
3. capture last tool/output state;
4. persist checkpoint;
5. mark stop reason.

## Run states

```text
STARTING
RUNNING
PAUSE_REQUESTED
CHECKPOINTING
PAUSED
RESUMING
WAITING_TOOL
BLOCKED
VALIDATING
COMPLETED
FAILED
TERMINATED
```

`COMPLETED` means the agent process finished its assigned run. It never means the engineering task or feature is `VERIFIED` or `DONE`.

## Stop reasons

```text
SOFT_TIME_LIMIT
HARD_TIME_LIMIT
TURN_LIMIT
TOKEN_LIMIT
COST_LIMIT
TOOL_LIMIT
FILE_SCOPE_VIOLATION
REPEATED_FAILURE
BLOCKED
DEPENDENCY_WAIT
MANUAL_PAUSE
NO_PROGRESS
PREEMPTED
COMPLETION_REPAIR_LIMIT
EVIDENCE_STALE
```

## Periodic checkpoints

Default:

```yaml
checkpoint_every:
  turns: 15
  wall_clock: 5m
```

## Progress score

Positive signals:

- failing test → passing test
- compile errors reduced
- acceptance criteria completed
- required TODOs reduced
- meaningful valid diff produced
- review findings closed

Negative signals:

- same failing test repeated
- same command repeatedly run
- same file repeatedly reverted
- cost increasing with no requirement progress
- large unrelated diff growth

If cost/tokens increase while progress remains near zero, pause and consider Recovery Agent.

## Dynamic budget extension

Agent may request:

```yaml
requested_turns: 20
reason: "Integration test exposed compatibility problem."
progress: 82
remaining:
  - "Implement compatibility handling."
```

Scheduler may:

```text
GRANT
DENY
REPLAN
PAUSE
ESCALATE
TERMINATE
```

## Preemption

Low-priority agents may be checkpointed and paused when a higher-priority task arrives.

The design should support more queued tasks than active Herdr worker slots.

## Structured handoff

Never hand off giant chat transcripts.

Persist:

```yaml
objective:
spec_digest:
completed:
remaining:
decisions:
current_diff:
failing_tests:
risks:
next_action:
```

A fresh agent should be able to resume from structured state.

## Completion repair budget

Completion repair loops have their own counter and budget. A retry is permitted only for referenced verifier findings and produces a new commit SHA.

```yaml
completion_repair:
  max_loops: 3
  on_exhaustion: NEEDS_HUMAN
  permit_silent_waiver: false
  require_reverification_after_commit_change: true
```

A limit stop must preserve partial work and clearly report unresolved finding IDs. The controller must never convert an exhausted run into `DONE`.
