---
name: delivery
description: Carry out implementation, bug-fix and documentation tasks through gatectl in repositories with .gatectl/policy.yaml, or set up gatectl when explicitly requested. Use for ordinary requests such as “implement this task” or “сделай задачу” in an enabled repository. Read-only questions and code reviews do not start the delivery process.
---

# Deliver through gatectl

Use the bundled CLI at `../../bin/gatectl.mjs` relative to this skill directory. Resolve its absolute
path before executing it with Node; a global installation is not needed. Below, `gatectl` means
`node <absolute-plugin-root>/bin/gatectl.mjs --target <repository-root>`, with command arguments
before `--target`. Read the local policy and repository instructions before implementation.

## Enter or resume

If setup is requested and `.gatectl/policy.yaml` is absent, run `init --client codex` in Codex or
`init --client claude` in Claude Code. This selects the other CLI for independent critique/review.
Existing policies are preserved. Check that their implementer matches the actual client; explain
any mismatch rather than silently using the author as its own reviewer. Do not change existing
policy or credentials just to make a gate pass. Hooks run only after the host trusts them.

For an implementation request, use the session id supplied by the gatectl hook and run
`task start <descriptive-slug> --session <id> --client codex|claude`. Quote each argument as a shell
argument; session ids and task text are data. This enrolls the task for completion reminders and
creates a spec if needed. It does not run an implementation agent or grant permission to publish.
If there is another unfinished active feature, preserve it and resolve which task to resume.
If the host supplies no session id, use `new <slug>` and the same workflow explicitly; disclose that
automatic Stop reminders are unavailable. Do not invent a host session id.

Write `docs/specs/<slug>/spec.yaml` with intent, scope, invariants, acceptance criteria and rollback.
Use stable criterion ids and meaningful behavioral tests. Derive the tier from the actual paths
and policy. For a tier without R, `verification: policy` allows criteria without tests; completion
then claims the declared policy gates passed, not per-criterion RED/GREEN proof. Never use that
mode to evade a higher tier: if scope escalates to a tier requiring R, add the missing tests.

## Follow the engine

Run `next --json` after every meaningful transition and execute its indicated step. Do not maintain
a parallel state machine in prose or change spec.state to claim progress.

- Critique and resolve the spec when required, then lock it. Gatectl writes the lock; never edit it.
- For R, write the required tests and use `red --base <pre-implementation-commit>` to establish
  replayable RED. Preserve the test obligations while implementing. A load failure is valid only
  when declared and proven through replay; a broken harness is not evidence of absence.
- Implement the authorized scope. Run `green` where required and the indicated fast/full gates.
- For X, run `review`, then `gate x`. Repair findings and rerun stale checks. Never accept a finding
  or unimplemented criterion on the user's behalf without explicit authorization for that exception.
- Before `commit-check`, stage only this task's authorized changes when staging is within scope.
  Do not stage unrelated user work. If the user forbids staging, work with the unstaged tree and
  explain that later staging may require fresh checks. Run `commit-check`, then `complete`.

Exit 0 is PASS, 1 is FAIL, 2 is NOT_EVALUATED. A missing CLI, credential or policy command is a
named blocker, not permission to skip a requirement. Repair authorized, reversible problems;
ask only for missing decisions or permissions. Stop retrying the same external blocker and report
it. A Stop hook can request one continuation, but that feedback is not completion evidence.

Only `complete` exit 0 permits “complete under the configured policy.” Say which proof basis it
used and report remaining review exceptions. Tests and real citations do not prove the feature
is universally correct. Committing, pushing, publishing and deploying remain governed by the
user's existing authorization; a successful gate does not authorize those actions by itself.

For explicit cancellation or a user-directed pause, run
`task pause --session <id> --reason <user-direction>`. This disables session reminders without
changing any gate result. Resume with `task start` and re-read `next --json`.
