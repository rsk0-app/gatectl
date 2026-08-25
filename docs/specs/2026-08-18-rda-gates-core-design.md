# RDA — Gates Core (piece 1 of 3)

**Product:** `rda` (rsk-delivery-agent) — a standalone delivery agent that installs into any
target repository from outside. No machinery lives inside the target project: the only thing
`rda init` writes there is `.rda/policy.yaml`, `.rda/MVP.yaml` and a `docs/specs/` directory.

**This spec covers piece 1 only:** the gate engine and its CLI. Piece 2 (Notion sync) and
piece 3 (night runner) build on it and get their own specs.

Predecessor: an earlier delivery model used in a production repository. Its concepts —
tiers computed from paths, L/R/G/X/C gates, meta-class files, "zero findings is not
approval", lock version chains — are carried over as knowledge. Its code is not: gatectl is a
clean rewrite in its own repository, because the model's own history showed that machinery
living inside the project it governs ends up entangled with it (the T-004 lock was blocked
by a parser bug in the very machinery the feature's repo hosted).

## Why this exists

Two failure modes observed in real use, both of which this core exists to prevent:

1. **Hallucinated completion.** An agent reports done; nothing outside the agent verifies
   it. Gate results must come from deterministic code running commands and reading files —
   never from the model's own account of what happened.
2. **Scope drift.** Work that is technically fine but was never asked for. The spec's
   `allowed_paths`, the diff check, and the MVP linkage make "not asked for" mechanically
   visible.

## Non-negotiable rules (inherited, restated)

1. No production code before the spec is locked. 2. No implementation before required tests
exist and RED is confirmed by running them. 3. Acceptance tests are read-only from RED
onward at a given lock version. 4. A critique with zero parsed findings is NOT_EVALUATED,
never approval. 5. Gate decisions are exit codes from deterministic checks; an LLM never
overrides them. 6. Blocking questions stop work; guessing is forbidden. 7. `DONE` requires
every gate green for the current digest.

## Shape

```
rsk-delivery-agent/            this repo — the product
  bin/rda.mjs                  CLI entry
  src/core/spec.mjs            spec.md parser (sections, ACs, required tests, allowed_paths)
  src/core/critique.mjs        critique parser — BOTH severity formats (see D-3)
  src/core/gates.mjs           gateL / gateR / gateGfast / gateGfull / gateX / gateC
  src/core/tier.mjs            tier from changed paths (first match wins, highest tier)
  src/core/lock.mjs            spec.lock.json version chain (digest, at, tier, paths)
  src/core/target.mjs          target-repo adapter: run commands, read diff, resolve paths
  src/adapters/critic-codex.mjs   codex exec wrapper (subscription, cheap model)
  test/                        vitest; every gate has failure-mode tests
  templates/                   policy.yaml, MVP.yaml, spec.md skeletons for `rda init`

target-project/                any repo gatectl is installed into
  .rda/policy.yaml             tiers, gate commands, meta_class, budgets
  .rda/MVP.yaml                out_of_scope[], mvp_done_when[]     (human-only)
  docs/specs/<id>/spec.md      feature specs + critique.md + spec.lock.json
```

gatectl always runs **against** a target repo (`--target <path>`, default cwd). It never assumes
it is inside the target. State lives in the target's `docs/specs/` (portable, reviewable);
the engine lives here.

## Commands (piece 1)

```
gatectl init                scaffold .rda/ + docs/specs/ in the target; interview → MVP.yaml
gatectl new <slug>          scaffold a spec, set it active
gatectl status              active spec, state, tier, gate results, next action
gatectl lock                gate L → append to spec.lock.json
gatectl red                 gate R → required tests fail on assertions (not load errors)
gatectl gate fast           G-fast: typecheck + tests related to changed files   (seconds)
gatectl gate full           G-full: build + full suite + diff checks             (minutes)
gatectl critique            cross-provider critique via codex exec; writes critique.md
gatectl review              cross-provider code review of the diff (tier A)
gatectl commit-check        gate C: all required gates green for current digest
```

## Design decisions

**D-1 — Tiers decide ceremony; the target's policy decides tiers.** A: full cycle
(L R Gfull X C), paths like migrations/auth/payments/api. B: spec-lite (L R Gfull C).
C: docs/styles (Gfast C + changelog line). Tier is computed from the diff, never chosen.
Defaults ship in the template; each target edits its own `.rda/policy.yaml`.

**D-2 — G is split.** `G-fast` = typecheck + `vitest related` on changed files; the
inner-loop signal, target < 30 s. `G-full` = build + full suite + diff checks
(no test deleted, no `.skip`/`.only` added, changed paths within `allowed_paths`); runs
before commit and as the night loop's exit check. G-full green is required for gate C;
G-fast green is never sufficient. Rationale: measured 233 ms for a feature's own test file
vs minutes for the suite; a slow inner loop is why suites get skipped entirely.

**D-3 — The critique parser accepts both severity shapes.** An explicit `SEVERITY: high`
line, or the level as a token in the block's first line (`## 3. **HIGH — …**`). Prose
mentioning "critical" must not invent a finding; a RESOLVED: line closes only its own
block. This is the exact bug that blocked T-004's lock: a 14-finding critique parsed as
zero. Regression-pinned by test with the verbatim real-world heading shapes.

**D-4 — Critic runs on the Codex subscription with a cheap model.** `codex exec` with a
low-cost model, read-only sandbox, refute mandate. Honesty note carried into the docs: with
no paid API call there is no spend-ledger provenance; the critique file is trusted at the
level of "a local run wrote it". Accepted deliberately (owner decision, 2026-08-18) to keep
marginal cost at zero; the parser + NOT_EVALUATED rules still hold. A `--api` flag can
restore ledger-backed provenance later without changing gate semantics.

**D-5 — MVP linkage is a lock requirement.** `spec.md` carries `mvp_ref:` naming an entry
in `.rda/MVP.yaml`'s `mvp_done_when` list (or `maintenance` for bugfixes/chores). Gate L
fails without it, and fails if the spec's intent contradicts `out_of_scope`. `.rda/MVP.yaml`
is meta-class: the agent may read it, only the human edits it. This is the anti-rabbit-hole
gate: forty perfect features that launch nothing become mechanically impossible to lock.

**D-6 — Spec format.** Required sections: `intent` (human language, Russian OK — why now,
for whom, success, not doing), `mvp_ref`, `invariants`, `acceptance_criteria` (each naming
its required test file), `allowed_paths`, `rollback`. `BLOCKING:` questions anywhere in the
file make lock impossible. Everything else (design decisions, notes) is free-form. Specs and
PR text are English; intent and questions to the owner are Russian.

**D-7 — Meta-class in the target.** `.rda/**`, `docs/specs/**/spec.lock.json` are never
agent-writable. Piece 1 enforces this in gate G-full's diff check (fail if the diff touches
them); PreToolUse-hook enforcement inside a Claude Code session ships with the day-mode
skill, not with this core.

**D-8 — Exit codes are the API.** Every command: 0 = green, 1 = not green, 2 = cannot
evaluate (NOT_EVALUATED — distinct, because "could not check" must never read as "checked,
fine"). The night runner and the day-mode skill both consume these codes; neither parses
prose.

## Errors

- Missing/unparseable spec section → named in output, exit 2.
- Required test file absent at R → exit 1 with the path; a load/compile error in it → exit 2
  (NOT_EVALUATED, never RED).
- Critic CLI absent, times out, or returns unparseable output → exit 2; never a silent pass.
- Target commands (build/test) are read from `.rda/policy.yaml`; a missing command → exit 2.

## Testing

The engine is the trust anchor, so it is tested harder than anything it will ever gate:
vitest, no network, temp-dir target repos built per test. Every gate gets its
failure-mode cases (the ways it must refuse), not only its green path. The critique parser
carries the verbatim T-004 regression corpus. TDD applies to gatectl itself: this spec's
acceptance criteria become failing tests before implementation.

## Acceptance criteria (v0.1)

- AC1 `rda init` on an empty repo scaffolds `.rda/` + `docs/specs/`; running it twice is a
  no-op (idempotent).
- AC2 `rda new` + hand-written spec + `rda lock` appends `{version: 1, digest, tier, paths}`
  to spec.lock.json; a second lock with an unchanged spec is a no-op.
- AC3 gate L exits 1 when: a required section is missing, a BLOCKING: question is open,
  `mvp_ref` is absent, or an unresolved critical/high finding exists. Exits 2 when the
  critique parses to zero findings.
- AC4 gate R exits 0 only when every required test fails on an assertion; a compile error
  exits 2.
- AC5 `rda gate fast` runs typecheck + related tests only; `rda gate full` additionally
  runs build + full suite + diff checks and fails on: deleted test, added `.skip`/`.only`,
  path outside `allowed_paths`, touched meta-class file.
- AC6 the critique parser passes the two-format corpus (explicit SEVERITY lines and
  T-004-style headings) and does not invent findings from prose.
- AC7 `rda commit-check` exits 0 only when all tier-required gates are green for the
  current spec digest and diff.

## Out of scope (piece 1)

Notion (piece 2), night runner (piece 3), Claude Code day-mode skill (thin wrapper, after
piece 1), PreToolUse guard hook, spend ledger, multi-target orchestration.
