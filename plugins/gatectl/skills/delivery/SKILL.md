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

## Plan a useful outcome before implementation

Use the existing task/spec to keep planning and delivery in one process. This guidance adds no
gate, mandatory document, approval round or model call. For a small edit, keep it brief.

- Recover the owner's agreed goal, ordering and already verified progress. Do not restart an
  audit on every continuation or quietly substitute a narrower goal. Define the observable
  result and what will prove it; completing an adapter alone does not complete its product path.
- Choose a coherent, reviewable stage with a useful result. Group tightly related code, tests,
  consumer wiring and documentation when they belong to that result. Split on actual dependencies
  or risk, not for progress reports; do not turn the whole MVP into one unreviewable change.
- Identify assumptions that could invalidate the approach: actual source shape, access, version
  semantics, existence of a required mechanism, or an owner decision. Check the important ones
  cheaply and early using read-only real data, existing code, primary sources or a bounded probe.
  Do not expand this into a universal audit. A parser rejecting data is not proof the provider
  is broken; resolve relevant documentation/implementation differences before assigning blame.
- Separate technical unknowns from missing owner decisions. Reuse earlier authorization and
  decisions. For a genuinely missing decision, prepare a concrete option and its consequences,
  ask before dependent work, and continue authorized independent work. Never invent an approval,
  infer consent from elapsed time, or repeatedly ask permission for work already authorized.
- Record remaining dependencies and the completion boundary in the existing spec. Passing gates
  for a limited stage does not close the original goal. After acceptance, continue the next
  authorized step or report the specific external dependency that prevents it. Explain progress
  through the goal, confirmed result and next action, rather than repeated activity reports.

For work that spans sessions or has unknowns, keep questions, attempts, conclusions and the next
step with the `context` skill (`gatectl work`); read `work brief` when resuming. It is context, not
evidence.

These are planning responsibilities of the implementing agent. Gate exit codes prove their
declared checks; they do not mechanically guarantee that the chosen scope was useful or that
an external source is complete.

## Fast workflow (default for new repositories)

New setup uses `init --mode fast --client codex|claude`. Existing repositories keep their policy.
Only when the user explicitly chooses a workflow change, use `workflow fast` or `workflow strict`;
review and commit that policy change separately. Never downgrade requirements to silence a failure.

For fast tasks, write a concise spec with `verification: policy`, intent, scope, criteria and rollback.
Implement a complete, reviewable stage. During implementation use ONLY `check-related` for changed
code; do not run `test-green`, full checks or a model review after every edit.

Before the final gates, ensure the chosen stage is actually ready: intended implementation,
necessary tests (including validity of new test code), available real-source checks, documentation
and intended diff. If known required edits remain, finish them first. Keep using the checks allowed
by the current workflow; this is not permission to bypass a required early gate or run duplicate
full suites. While a long check runs, preserve its candidate tree and do useful independent work.
Investigate unusually long delays before retrying; do not launch duplicate checks blindly.

At the end of the stage:

1. Stage the intended task changes if authorized. Run `check` once: the declared full test command,
   typecheck and build. Do not separately run the same npm test/build commands around it.
2. Run `review` once, then `review-check`. If repairs are needed, use related tests while editing,
   then `check` and `review` again. A fast follow-up review receives only the delta plus the prior
   report, retaining unresolved findings. An unchanged candidate reuses its existing review.
3. Run `ready-to-commit` and `finish`. These and `next --json` read saved evidence; they do not run
   tests, build commands or models. Follow `next --json` when unsure of the remaining step.

Receipts are shared across equivalent expanded commands, including test-green and check-all.
Different test selectors or a different command are NOT interchangeable. Changed code, dependency
metadata, policy, environment or configured inputs invalidate reuse. Use `check --fresh` when
external inputs change (services, remote data, tool configuration not captured locally); do not
silently trust cached integration checks. The owner can disable reuse with `workflow.cache: false`.
Use `review --full` to deliberately request a complete review again.

## Strict workflow (explicit selection)

Follow the policy through `next --json`: critique/spec-check, replayed `test-red --base <sha>`,
implementation, `check`, review/review-check, ready-to-commit, finish. The final `check` also proves
criterion GREEN where R is required and reuses exactly matching commands across checks. Do not
invent failing tests or classify broken harnesses as RED. Independent `verify --rerun` is an
explicit release/strict check; never introduce it, CI or a local referee into the default fast loop.

Never accept an unimplemented criterion or finding on the user's behalf without explicit approval
for that exception. Preserve unrelated user work and existing permission boundaries.

Exit 0 is PASS, 1 is FAIL, 2 is NOT_EVALUATED. A missing CLI, credential or policy command is a
named blocker, not permission to skip a requirement. Repair authorized, reversible problems;
ask only for missing decisions or permissions. Stop retrying the same external blocker and report
it. A Stop hook can request one continuation, but that feedback is not completion evidence.

Only `finish` (legacy `complete`) exit 0 permits “complete under the configured policy.” Say which proof basis it
used and report remaining review exceptions. Tests and real citations do not prove the feature
is universally correct. Committing, pushing, publishing and deploying remain governed by the
user's existing authorization; a successful gate does not authorize those actions by itself.

For explicit cancellation or a user-directed pause, run
`task pause --session <id> --reason <user-direction>`. This disables session reminders without
changing any gate result. Resume with `task start` and re-read `next --json`.
