# Critique — stop-completion-context

- provider: openai
- model: claude-fable-5-1
- round 1

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. AC-02 "changed file inputs" cannot go RED on input binding

SEVERITY: high

Scenario: fixture has no `.gitignore`. Test writes `.env` (default `input_paths`) after finish+commit. `treeDigest` in unstaged mode runs `git add -A` on a throwaway index, so untracked `.env` enters the tree. Tree mismatch refuses before `input_context` is ever compared. An implementation with no input binding at all passes this case. Same for "missing input binding": deleting `input_context` from completion.json breaks the HMAC, so it is indistinguishable from "corrupted completion". Neither negative case discriminates.

Fix: AC-02 test must (a) gitignore the input file, or use a `dependency_paths` entry that is gitignored, so tree stays equal and only `input_context` differs; (b) for "missing binding", re-sign completion.json without the field using the fixture key from `GATECTL_STATE_DIR` (or run finish with a bundle built at 0.16.2) and assert refusal.

RESOLVED: AC-02 now ignores .env.local and node_modules/tool in Git and creates an authentic fixture-owner signed legacy receipt without input_context. These cases discriminate input binding from tree/signature checks.

## 2. Runtime/platform binding defeats the stated field scenario; test cannot detect it

SEVERITY: high

`executionContext` hashes `process.versions`, `platform`, `arch`. Spec keeps "runtime" bound in `input_context`. rsk0 repro is "hook invoked through Python": that hook resolves `node` from the host PATH, often not the nvm node the agent shell used for check/finish. Then `input_context` mismatches → fallback → same "no implementation" as today. AC-01 test spawns hook and CLI with the same `process.execPath`, so it passes while the field case still fails.

Second unverified root cause with identical symptom: `loadKey` honors `GATECTL_ATTEST_KEY`, and state root honors `GATECTL_STATE_DIR`. If either is set in the agent shell but absent in the host hook env, the hook reads an empty/other ledger → `results=[]` → `IMPLEMENTING "no implementation yet"`. Spec.md asserts the cause is env in receipts without excluding this.

Fix: spec must state which of node version / key env / state dir differ in rsk0 (record `next --json` plus `node -v` and key source from both invocations). If node differs, drop `runtime` from `input_context` (attestation already records env "reported, never compared") or add AC-01 variant spawning the hook with a second node binary. If key/state dir differ, this spec does not fix rsk0.

RESOLVED: Read-only rsk0 comparison confirms identical Node executable/version, state directory and filesystem key source. Only full environment context differs; empty-env input context matches. Evidence and runtime limitation are recorded in spec.md; runtime binding remains required.

## 3. Spec.md paragraph 4 is untested and outside allowed paths

SEVERITY: high

"Normal next must say checks are stale instead of claiming no implementation" changes normal `next` output. The message originates in `nextStep` (`src/core/next.mjs:65`), not in allowed_paths. No AC covers it. Also contradicts spec.md line 7 ("a Stop reminder is not a request to rerun commands"): a stale-checks fallback will emit `Next: gatectl check`, i.e. rerun commands in host env, then finish there, producing a new host-env acceptance. That is permitted by INV-01 but is exactly what the spec says the reminder is not.

Fix: either add AC-03 with a test for the stale message and add `src/core/next.mjs` to allowed_paths, or delete the paragraph. Define the fallback reason text explicitly.

RESOLVED: AC-01 now explicitly tests normal next requesting checks after environment drift; commands.mjs supplies hasImplementation from authenticated historical checks. next.mjs is unchanged. Spec defines normal fallback as a check request when recognition cannot be established.

## 4. "Publish an updated plugin" conflicts with allowed_paths and version-keyed caches

SEVERITY: medium

Intent: "Publish an updated plugin after acceptance." Rollback: "Install 0.16.2", implying a new version. allowed_paths excludes `package.json`, both plugin manifests, `marketplace.json`, `CHANGELOG.md`. `scripts/build-plugin.mjs --check` fails if manifest version differs from CLI, so bumping only some files fails gates. Host plugin caches are version-keyed (this session runs `.../gatectl/0.16.0/bin/gatectl.mjs` while repo is 0.16.2): republishing 0.16.2 with a new bundle reaches no installed host. Precedent `release-0-16-2` used a separate spec.

Fix: remove publish from intent; state "release 0.16.3 via separate release spec" as in spec.md last paragraph. Keep `plugins/gatectl/bin/gatectl.mjs` regeneration here.

RESOLVED: Removed publication from implementation intent; stable 0.16.3 metadata and publication are explicitly a separate subsequent spec.

## 5. "Latest successful completion ledger" is ambiguous and completion.json is not chained

SEVERITY: medium

Completion record has no `ledger_head` (attestation does). Scenario: finish ACCEPT at tree T1 in env A; copy `completion.json` aside; in env B run finish → REJECT at same T1, completion.json overwritten, ledger appends `Complete FAIL`; restore saved file. Signed ACCEPT ✓, tree/spec/policy ✓, attestation ✓, `input_context` ✓. If "latest successful" means most recent PASS entry ignoring later FAIL → recognized although the latest authoritative decision was REJECT. If it means latest entry must be PASS → refused. Spec does not say.

Fix: require the latest `Complete` entry to be PASS with matching tree/digest, and record `ledger_head` in completion.json so a restored older file cannot outlive a later decision.

RESOLVED: Recognition requires the final authenticated ledger entry to be Complete PASS and bind the exact completion MAC, so later decisions and restored older files cannot be ignored.

## 6. Hook budget: extra fingerprint walks under 10s child timeout

SEVERITY: medium

`next` already calls `executionContext` several times (currentResults in next, twice in gateCContext, again via `attested`). Recorded path adds at least one more full dependency walk over `node_modules`. Timeout → `r.status !== 0` → `next=null` → block "could not evaluate". Same symptom, new cause, no AC bounds it.

Fix: walk deps once per process and hash twice (with env, with `{}`); or state a budget AC using a fixture with a large `dependency_paths` tree.

RESOLVED: The accepted-record branch runs before ordinary context walks and does one input walk. Live rsk0 post-install probe must fit the unchanged child timeout.

## 7. Foreign-env finish destroys the recognized record

SEVERITY: low

Agent, seeing any block, runs `finish` in host env → STALE_ENVIRONMENT → REJECT → completion.json overwritten, `Complete FAIL` appended. Recorded path now refuses permanently. Recovery needs finish "in the original environment", but env is only a hash; the user cannot identify it. Spec should say finish REJECT output names the stale-environment cause and that the recorded path is one-shot fragile, or decide finish must not overwrite an ACCEPT for the identical tree/spec/policy when the only failed predicate is environment staleness.

RESOLVED: Spec explicitly preserves later finish refusal as authoritative. Recovery requires valid-context checks/finish; the historical branch never hides a later FAIL.

## 8. AC-01 assertion `{}` is not discriminating

SEVERITY: low

Hook returns `{}` for COMPLETED, paused session, plan mode, and unenrolled session. A regression that drops session lookup passes AC-01. Fix: test also asserts `next --recorded-completion --json` state is COMPLETED in the changed env and plain `next --json` in that env is not, plus `check` output lacks "reused check".

RESOLVED: AC-01 will assert explicit recorded-completion state as well as normal next state, then assert changed-environment finish failure and subsequent Stop blocking.

