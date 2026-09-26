# ADR 0001 — Context layer on top of the gates

- Status: accepted (owner instruction, 2026-09-25); stage 1 implemented in `work-state-brief`
- Requirement: [`../context-layer-spec.md`](../context-layer-spec.md)

## Problem

On a large product (~1500 commits) the owner cannot see whether an agent understood the goal, what
is actually verified versus claimed, or whether work is going in circles. gatectl today controls
only the exit — whether a task may be called done — and keeps nothing about how the work went.

## Inventory (HEAD 1b6f515, 0.16.3)

Reused as is — the context layer adds no second system of any of these:

| Mechanism | Where | Role for the context layer |
|---|---|---|
| HMAC ledger, attestation, completion | `src/core/{ledger,attest,completion}.mjs`, `$STATE/features/<slug>/` | The only evidence. Context never writes it. |
| Check receipts, tree/execution fingerprints | `src/core/check-cache.mjs`, `target.mjs` | Staleness of evidence; `treeDigest` also fingerprints input-less attempts. |
| `next` state machine | `src/core/next.mjs` | Current delivery stage; derived, never stored. |
| Critique / review via second CLI | `src/adapters/critic-codex.mjs`, `src/core/review.mjs` | The existing independent review; the future model pair builds on it, does not replace it. |
| Plugin hooks (SessionStart, UserPromptSubmit, Stop) | `src/cli/plugin-hook.mjs` | SessionStart now carries the work brief. |
| Delivery skill | `plugins/gatectl/skills/delivery` | Unchanged process; points to the `context` skill. |
| TDAM memory export | `src/adapters/memory-tdam.mjs` | Optional team memory; independent of the local store. |

Absent before this ADR: research/attempt records, checkpoints, context brief, code index,
architecture/capability maps, task graph, subagent coordination.

Design-only material, **not the current process** (kept for history, do not follow it as
requirements): `docs/01`–`08` concepts without code — Herdr, scheduler, execution controller,
budgets, validation swarm, 25-state lifecycle, gates G0–G15, capability firewall — and every file
in `schemas/*.json`, `spec/*-template.*` and `policies/default-policy.yaml` (no code references
them). `docs/specs/2026-08-18-*` describes an older layout (`.rda/`, `gates.json`).

Defects found during the inventory:
- Fixed in `fix-issued-verify-review-reuse`: `checkIssued` was called in `commands.mjs` (verify,
  ed25519 path) but never defined → exit 2; review reuse wrote `review.md` while gate X reads
  `review.json`; criterion acceptance lost the reviewer's reasoning.
- Gate X compares the reviewer's self-reported model name with the implementer — self-description,
  not provider-verified identity.
- `.github/workflows/gatectl-verify.yml` pins v0.12.0 and old `.rda` paths.

Conflicts resolved with the owner:
- `.gatectl/MVP.yaml` excluded "producing code structure"; its "approved" line was agent-written.
  Rewritten on the owner's instruction (goals `work-continuity`, `owner-visibility`, `code-map`);
  gates still never read the network, the context store or a code index.
- Policy named Codex as implementer while Claude Code implements; roles swapped so Codex reviews.

## Decisions

1. **One plugin, context beside gates.** New code lives in `src/context/**`, loaded lazily. Nothing
   reachable from gate, next, completion or Stop paths imports it (`test/work-state.test.mjs`).
2. **Storage.** Built-in `node:sqlite`, one store per worktree under the gatectl state directory.
   Unique work state (this stage) and future rebuildable indexes go in separate tables/files so a
   rebuild never deletes research. Existing stores are validated on a copy before any write;
   damaged or newer ones are refused untouched. Export/import for backup.
3. **Git keeps agreed artifacts** (requirements, decisions, later capability/architecture maps);
   SQLite keeps derived indexes and in-progress work state.
4. **Provenance.** Every conclusion records kind (declaration/fact/hypothesis/check), author,
   source attempt/question and input fingerprints; model output defaults to `hypothesis`.
5. **Code index engine (stage 5):** TypeScript compiler API from the target project's own
   dependencies for TS/JS; other languages reported as unsupported, never as "no results".

## Plan

| Stage | Result for the owner | Status |
|---|---|---|
| 1 | Work store, loop guard, freshness, `work brief`, SessionStart brief | done in `work-state-brief` |
| 2 | Owner goal: agent drafts goal/scope/success from the owner's words, owner confirms; confirmation recorded with source | done in `owner-goal` |
| 3 | Capability map (agreed / implementation found / tests exist / tests passed on current version), piloted on ops8 | planned |
| 4 | Next-step proposals: compare capability map with the goal | planned |
| 5 | Local code index + architecture map with honest coverage | planned |
| 6 | Model pair protocol (independent first pass, disagreements → questions), task graph and subagents | planned |
