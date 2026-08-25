# codegraph-note

state: DRAFT
mvp_ref: maintenance

## Intent
Record in the README that registering a target repository with CodeGraph is a one-time call made
by a human, never by rda, so the step is not lost in conversation — and enforce the "never by
rda" half with a test rather than with prose.

CodeGraph answers "what does this code look like": symbols, callers, impact. rda answers "what
was done to it and under what ceremony". The first is consumed by agents through the memory
service's own tooling; rda is not a party to it. Documenting the call keeps the setup
reproducible without giving rda a code path it must then carry forever.

## Invariants
- No file under `src/` imports, names, or calls a CodeGraph endpoint, and a test enforces this
- The README states that a human runs the registration and that agents, not rda, consume the result
- The documented call names its exact endpoint, required fields, credential source, and idempotency behaviour

## Acceptance Criteria
- The README documents the registration call with endpoint, required fields, credential source from the environment, and the idempotency guarantee — required: test/readme-codegraph.test.mjs
- No source file under `src/` references CodeGraph, so the note cannot silently become an integration — required: test/readme-codegraph.test.mjs

## Allowed Paths
- README.md
- test/**

## Rollback
Revert the README section and delete `test/readme-codegraph.test.mjs`. Nothing under `src/`
changes, so no runtime behaviour can regress.

## Notes

The call being documented, verified against the service's `openapi.yaml`:

```
POST {endpoint}/code-graph/create
Authorization: Bearer $TDAM_API_KEY
x-tdai-service-id: $TDAM_SERVICE_ID
{"team_id": "...", "repo_url": "...", "branch": "main"}
```

Required fields are `team_id` and `repo_url`; `branch` defaults to `main`. The call is
idempotent on `(service_id, team_id, repo_url, branch)` — a repeat returns the existing record
with HTTP 200 instead of creating a second, so a lost response is safely retried. It returns
immediately with `status: pending`; cloning and indexing run in the background, and progress is
read from `/code-graph/status`.

Credentials come from the environment, never from `.rda/policy.yaml`, which is committed — the
same rule the memory integration already follows.

Mapped against `MVP.yaml`'s out-of-scope list: this change is *documentation of* a boundary the
list already draws ("rda producing code structure … indexers do that, agents consume it"). It
adds no gate that reads from a network service and no code path in rda, so it contradicts
nothing there.
