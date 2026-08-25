# gatectl ↔ TencentDB Agent Memory — design

- Status: approved 2026-08-19
- Scope: `rda export` (write) + memory-informed `rda critique` (read)
- Non-goals: Skills assets, CodeGraph registration, any memory read inside a gate

## Why

`rda` decides. It does not remember. Every feature it gates produces durable, hard-won
text — a locked spec, an adversarial critique with resolutions, a tier derivation, a gate
ledger with real outcomes — and today all of it stays in one target repository's
`docs/specs/`. The next feature, and the next agent, start cold.

[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) is a
team-level memory hub: four asset types (Chat Memory, Skill, LLM-Wiki, Code-Graph) behind an
HTTP API, with agent-side retrieval already solved by its proxy. It is the natural home for
what `rda` produces.

## The line this design does not cross

`rda`'s entire value is that a gate result is a deterministic function of files on disk. A
gate that consults a networked, LLM-backed, asynchronously-indexed service is no longer that.

**No gate reads from memory. Ever.** `L`, `R`, `G-fast`, `G-full`, `C` do not know memory
exists. Memory sits on the advisory side of the line `rda` already draws — the same side as
`critique`, which produces text that gate `L` then judges deterministically.

This is enforced by a test, not by discipline: `test/memory-boundary.test.mjs` fails if
`src/core/**` gains any import of the memory adapter.

### Rejected: memory inside gates

`/code-graph/impact` could genuinely strengthen `G-full` — "symbol X changed, it reaches Y,
are Y's tests in the required set?". Rejected anyway:

- The gate would answer `NOT_EVALUATED` whenever a docker stack is down. `rda` would block
  commits for infrastructure reasons, and `2` is contractually "the gate refused to answer".
- The code index lags the working tree. A gate bound to `treeDigest` would silently judge
  against stale structure — worse than not judging.

### Rejected: Skills and CodeGraph assets

- **Skills.** `rda`'s protocol is identical every run: tier from paths, gates from tier. A
  Skill encoding "lock, then red, then gate full" restates the README. Near-zero content in
  exchange for a `/v3/skill/*` client, version handling, and `expected_version` conflict
  resolution.
- **CodeGraph.** Registration happens once per target repository, ever, and indexes the
  target's code rather than `rda`'s delivery record. That is one documented `curl` in the
  target's README, not a code path in `rda`.

Both are an hour's work to add later if the wiki path proves its worth. Cutting them now is
cheap to reverse; carrying them now is not.

## Architecture

Two new files, mirroring the existing `core` / `adapters` split:

| File | Responsibility | Talks to network |
| --- | --- | --- |
| `src/core/memory-page.mjs` | Render a feature's artifacts to a markdown page + a stable `ref`. Pure function of already-parsed data. | no |
| `src/adapters/memory-tdam.mjs` | HTTP client for MemoryKnowledge: config resolution, `/wiki/create`, `/wiki/page/write`, `/wiki/search`. | yes |

The split matters for testing: page rendering is exercised without a server, and the adapter
is exercised with an injected `fetch`, the same way `runCritic` takes an injected `exec`.

`src/cli/commands.mjs` gains `export` and one optional block in `critique`.

### Upstream API (verified against the repository, branch `feat/server_team`)

MemoryKnowledge, default `http://localhost:8421/v3`. All endpoints are `POST` with a JSON
body and an `ApiResponseEnvelope` response (`code: 0` means success; non-zero is a business
error even under HTTP 200).

| Endpoint | Use |
| --- | --- |
| `/wiki/create` | Idempotent on `(service_id, team_id, name)` — returns the existing `wiki_id` on repeat. Does not trigger ingest. |
| `/wiki/page/write` | Batch write of processed pages, **max 20 per call**. Auto-injects `locked:true`, so the LLM ingest pipeline never rewrites what we wrote. |
| `/wiki/search` | BM25 full-text over a wiki's pages. Read path only. |

Headers: `Authorization: Bearer <api_key>`, `x-tdai-service-id: <service_id>`,
`Content-Type: application/json`.

`locked:true` is the reason this integration is defensible: `rda` writes deterministic facts
and they stay verbatim.

### Configuration

`.rda/policy.yaml` gains an optional `memory:` block:

```yaml
memory:
  endpoint: "http://localhost:8421/v3"
  team_id: "team-abc"
  wiki_name: "delivery-record"     # optional; defaults to the target repo's directory name
```

Secrets never live in policy: `.rda/policy.yaml` is committed inside the target repository.
They come from the environment only:

- `TDAM_API_KEY` — bearer token
- `TDAM_SERVICE_ID` — tenant id for `x-tdai-service-id`

Absent `memory:` block, or absent either variable: `export` reports what is missing and exits
`2`; `critique` proceeds silently without memory context.

### Page model

One wiki page per feature. `ref` is `rda/<slug>.md` — stable, so re-exporting a feature
overwrites its page rather than accumulating duplicates.

Page content, rendered from what `rda` already parses:

```markdown
# <slug>

- tier: B (derived from allowed paths)
- state: LOCKED
- spec digest: <first 12 chars>
- exported: <ISO 8601>

## Intent
...

## Invariants
- ...

## Acceptance criteria
- ... — required: test/a.test.ts

## Allowed paths
- src/**

## Rollback
...

## Gate outcomes
| gate | status | at |
| L | PASS | ... |
| R | PASS | ... |
| Gfull | PASS | ... |

## Critique findings
- [critical] <title> — RESOLVED
- [high] <title> — UNRESOLVED
```

Only the latest ledger entry per gate is rendered — the same rule gate `C` applies.

## Commands

### `rda export`

1. Open target, resolve the active feature. No policy or no active spec → `2`.
2. Resolve memory config. Missing block or missing env var → `2`, naming what is missing.
3. Render the page (pure).
4. `--dry-run`: print the page and the resolved `ref`, exit `0`. No network call.
5. Otherwise: `/wiki/create` (idempotent) → `/wiki/page/write` with one page.
6. Exit `0` on `code: 0`; `2` on transport failure, non-zero envelope code, or HTTP error.

Exit codes are `0` and `2` only. `export` is not a gate and must never emit `1` — `1` means
"a gate ran and said no", and nothing about a failed upload is a gate verdict.

`export` is deliberately a separate command, never a side effect of `commit-check`. The trust
anchor performs no network I/O.

### `rda critique` — memory context

Before building the prompt, if memory is configured and reachable, `/wiki/search` for the
active spec's intent, take the top few pages, and append them to the prompt as a clearly
fenced `<<<DATA ... DATA>>>` block, matching the existing treatment of untrusted input in
`buildCritiquePrompt`.

Retrieved pages are data, never instructions — the prompt says so explicitly, as it already
does for the spec text and the out-of-scope list.

Any failure — unconfigured, unreachable, timeout, non-zero envelope — is a silent no-op.
`critique` runs exactly as it does today. A memory outage must never change a gate's answer,
and gate `L` judges the resulting critique by the same deterministic rules regardless.

Timeout: 5 seconds, so an unreachable host cannot stall the critic.

## Error handling

| Condition | `export` | `critique` |
| --- | --- | --- |
| No `memory:` in policy | `2`, "policy has no memory block" | silent no-op |
| Missing `TDAM_API_KEY` / `TDAM_SERVICE_ID` | `2`, naming the variable | silent no-op |
| Host unreachable / timeout | `2`, naming the endpoint | silent no-op |
| Envelope `code != 0` | `2`, printing `code` and `message` | silent no-op |

The asymmetry is the point: a write the operator asked for must fail loudly; a read that only
enriches advice must never be able to break the run.

## Testing

| Test | Proves |
| --- | --- |
| `test/memory-page.test.mjs` | Rendering is complete and deterministic: tier, digest, gates, findings with resolution state; `ref` is stable across exports. |
| `test/memory-tdam.test.mjs` | Injected `fetch`: correct headers, `create` before `write`, `code != 0` surfaces as failure, transport throw is caught, `critique` search failure returns empty rather than throwing. |
| `test/memory-boundary.test.mjs` | No file under `src/core/` imports the memory adapter. Fails loudly if a future change wires memory into a gate. |
| `test/cli-smoke.test.mjs` (extended) | `rda export --dry-run` prints a page and exits `0` with no server running. |

No test requires the docker stack. The adapter is injected, exactly as `runCritic` is.

## Verification

Per project practice, a green suite is not the evidence. Before this is called done:

- `rda export --dry-run` runs against the real target repository used for the 0.1.1
  verification and prints a page containing that feature's real gate outcomes.
- If a MemoryKnowledge instance is available, a real `export` reaches `code: 0` and the page
  is readable back via `/wiki/page/read`.
- `rda commit-check` still reaches `0` on that target with `memory:` configured and with the
  memory host deliberately unreachable — proving the trust anchor is untouched either way.

## Rollback

Delete `src/core/memory-page.mjs`, `src/adapters/memory-tdam.mjs`, the `export` command, and
the memory block in `critique`. Nothing else depends on them; the `memory:` policy key is
optional and ignored when unread.
