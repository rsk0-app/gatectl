# Critique — execution-context-walk

- provider: openai
- model: claude-fable-5-1
- round 2
- earlier rounds: 8 finding(s)

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Non-ENOENT `lstat` failures on children now crash the walk; legacy skipped them

SEVERITY: high

Spec.md enumerates only "dangling links and absent or ENOTDIR configured paths" as omitted. New walker at `check-cache.mjs:21-22` rethrows every `lstatSync` error except ENOENT. Legacy used `existsSync`, which returns false on any error.

Scenario A: `node_modules/foo` has mode 0o644 (readable, not searchable; happens with `chmod -R 644`, Docker bind mounts, root-owned `.venv`). `readdirSync(foo)` succeeds. `lstat(foo/index.js)` → EACCES. Legacy: `existsSync` false, entry omitted, `foo` itself recorded. New: throw propagates out of `executionContext`. `gatectl check` dies with uncaught EACCES. `next --json` exits nonzero. Stop hook gets `next = null` → `decision: block` "could not evaluate the current state". A tree legacy fingerprinted fine now blocks every Stop.

Scenario B: pnpm virtual store path exceeding PATH_MAX (1024 on macOS). Legacy: `existsSync` false → skipped. New: `lstat` → ENAMETOOLONG → throw.

Both contradict INV-01 "fingerprint ... unchanged" and AC-01 "identical ... including missing paths". Test fixture covers neither.

Fix: spec.md must state "any `lstat`, `realpath` or `stat` failure on an entry omits it, matching `existsSync`; only `readdirSync` failures propagate". Implementation: `catch { return }` at line 22. Test: add a 0o644 directory containing a file (skip when `process.getuid() === 0`), assert no throw and digest equals legacy.

RESOLVED: Child lstat now suppresses failures like legacy existsSync. Added readable/unsearchable directory regression; later stat/realpath races still propagate as legacy did.

## 2. Call bound of 15 on a flat fixture cannot distinguish per-file from per-directory ancestor resolution

SEVERITY: medium

Round 1 fix asked for "at most roots + symlinks". Revision spies native too but bounds at `< 15`. Actual count for fixture is 6 (roots alias, deps, .env; symlinks cycle, file-alias; root `deps` re-resolved then deduped). Fixture has exactly two real directories (`deps`, `deep`) and 200 files in one of them.

Scenario: implementer keeps `realpathSync` for every *directory* child and inherits only for files. Fixture calls: 3 roots + `deep` + `cycle` + `file-alias` + `deps` root ≈ 7. Passes. On rsk0 `node_modules` with tens of thousands of directories, ancestor resolution per directory still runs O(dirs × depth). Intent unmet, AC green.

Fix: fixture with 200 sibling directories each holding one file, plus nested depth 10. Assert `calls === 3 + symlinkCount` exactly, or `calls <= roots + symlinks` computed from fixture constants, not a literal.

RESOLVED: Fixture now includes 200 sibling directories and asserts exactly five JS/native resolution calls.

## 3. Manual acceptance "Stop returns {}" is satisfiable without the walker running

SEVERITY: medium

`hookResponse` at `plugin-hook.mjs:11-14` returns `{}` when: no session for `session_id`, session paused, `permission_mode === 'plan'`, or `next.state === 'COMPLETED'`. Only the last proves `next` finished under ten seconds. Spec.md says "Stop from the project directory returns {}" with no precondition on session state.

Scenario: tester runs Stop with a stale or unenrolled `session_id`, gets `{}`, records pass. Walker could still take twelve seconds. Also "Repeat a timed complete hook before installation" names no procedure or number to record.

Note the COMPLETED path is heaviest, not lightest: `next` runs `currentResults` at `commands.mjs:622` plus `gateCContext` twice inside `attested` at line 648, so three walks plus four `treeDigest` disposable-index writes. At the measured 0.97s per walk that is ~3s before git.

Fix: manual acceptance must require an enrolled, unpaused session whose slug equals `docs/specs/ACTIVE`, and record wall time of `node <cli> next --json --target <rsk0>` in spec.md with a stated ceiling (e.g. under 6s, leaving headroom for reminderSignature's 4s git budget inside the 20s host limit).

RESOLVED: Spec records enrolled unpaused matching session, direct COMPLETED, full timed hook at 8.839s and scan comparison; no universal latency guarantee is claimed.

## 4. Claude marketplace manifest carries a version, is outside allowed_paths, and is not checked

SEVERITY: medium

Spec.md: "aligned across CLI and both plugin manifests". `package.json` and both `plugin.json` say `0.16.1+codex.20260910064758`. `.claude-plugin/marketplace.json:11` says `0.16.1`. Not in `allowed_paths`. `scripts/build-plugin.mjs --check` verifies only the two `plugin.json` files (line 32-35), so drift is silent.

Scenario: Claude Code install via `claude plugin marketplace add /abs/checkout` resolves plugin version from the marketplace entry, keys cache `~/.claude/plugins/cache/gatectl/gatectl/0.16.1/`. A machine that already has 0.16.1 cached from the public release keeps the old bundle. Stop in Claude Code runs the pre-fix walker. Spec's "Codex cachebuster" covers Codex only, yet this repo's own Stop hook (the one that motivated the spec) runs in Claude Code per `policy.yaml` critic/reviewer config and this session's hook path.

Fix: either add `.claude-plugin/marketplace.json` to `allowed_paths` and bump its version in lockstep, extending `build-plugin.mjs --check` to cover it, or state in spec.md that Claude verification uses `claude --plugin-dir` only and marketplace install is not claimed.

RESOLVED: Spec explicitly limits installation to Codex local build; no Claude marketplace distribution claim.

## 5. Rollback leaves installed hosts on the reverted-from bundle

SEVERITY: low

Rollback strategy: "Revert walker and regenerate bundled CLI." Version string is the cache key for both hosts. Reverting `check-cache.mjs` and regenerating `plugins/gatectl/bin/gatectl.mjs` without a new build-metadata suffix produces a bundle with the same `0.16.1+codex.20260910064758`. `codex plugin add` sees an already-installed version, keeps the cache. Hosts continue running the walker the rollback removed. Receipts stay compatible, but the rollback does nothing observable.

Fix: rollback strategy must include "bump build metadata and reinstall on each host", or state that rollback takes effect only on next reinstall.

RESOLVED: Spec rollback now requires fresh cachebuster and reinstall.

## 6. Spec.md test claims exceed what the test does; oracle is adapted, not copied

SEVERITY: low

Spec.md line 7: tests include "input ... changes". Test never mutates `.env`; only `deps/deep/0.js` and env var change. An implementation that skipped `input_paths` entirely would fail equality anyway, but the specific claim is false.

Spec.md line 7: "copies the walker from commit 6527cc3; do not adapt it". The copy at `test/execution-context.test.mjs:11-25` drops `?? ['node_modules', '.venv']`, `?? ['.env', ...]` and `env_allow`. Policy passes explicit lists, so INV-01 "fingerprint inputs unchanged" has no oracle for defaults. Editing the default list in `check-cache.mjs:36-37` passes AC-01.

Fix: one extra `executionContext(root, { workflow: {} }, env)` call compared against a reference retaining the `??` defaults, and either mutate `.env` or delete "input changes" from spec.md.

Out-of-scope check: no spec content contradicts the declared list. Walk stays on-disk files, no network, no UI, single repo.

<!-- carried forward: raised in an earlier round and still unanswered -->

RESOLVED: Reference restores original defaults/env_allow; tests compare default policy and mutate .env.

## 1. "Resolve only symlinks" breaks equivalence whenever an ancestor of a root entry is a symlink

SEVERITY: critical

Scenario: `root` is `/var/folders/xx/T/rda-abc` on macOS (every `fs.mkdtempSync(os.tmpdir())` test). `node_modules` there is a plain directory, not a symlink. Legacy walker at `check-cache.mjs:13` calls `realpathSync` on the top-level entry and records `real = /private/var/folders/.../node_modules`. An implementer following spec.md literally ("resolve only symlinks") does `lstat` on the entry, sees a directory, and carries `/var/folders/.../node_modules` as the resolved parent. Every child tuple's second element differs. Digest differs. Worse: any symlink inside the tree that points back into it resolves via `realpathSync` to the `/private/...` form, misses the `seen` set, and gets walked a second time, adding entries legacy never had. Same failure on Linux with any symlinked project root, home dir, or `/tmp`.

Fix: spec must state that each root entry from `dependency_paths` and `input_paths` is always resolved with `realpathSync`, and that only children inherit the parent's resolved path. The AC test must run its fixture under a symlinked root so the reference-implementation comparison fails if this is skipped.

RESOLVED: Configured roots always use realpathSync; fixture executes through a symlinked root.

## 2. Dangling symlinks: legacy skips them silently, spec does not say so

SEVERITY: high

Scenario: `node_modules/.bin/foo -> ../foo/cli.js` where `foo` was removed by a partial reinstall. Legacy: `existsSync` follows the link, returns false, entry is omitted. New walker: `lstat` succeeds, `isSymbolicLink()` true, `realpathSync` throws ENOENT. If the implementer lets it propagate, `executionContext` throws, `cachedRunner` throws, and `next --json` exits nonzero, which the Stop hook reads as "no answer". If the implementer records the link with `lstat` metadata instead, the digest gains an entry legacy never had. Either way receipts stop matching. AC-01 says "missing paths" but means absent root entries, not dangling links mid-tree.

Fix: AC-01 must enumerate the error taxonomy: any failure to resolve or stat an entry skips it, matching `existsSync` semantics, while `readdirSync` failures on a resolved directory still propagate as today. Test fixture must include a dangling symlink and an ENOTDIR path.

RESOLVED: Fixtures cover dangling root and child links and ENOTDIR input; existsSync on symlinks preserves omission. Child lstat error compatibility added.

## 3. Symlink metadata must come from the target, spec is silent

SEVERITY: high

Scenario: `node_modules/.bin/vitest` is a symlink to a file. Legacy records `statSync(real)`: target size, mtime, ctime, mode 0o100755. A walker that already holds an `lstat` result for the symlink check is tempted to reuse it: size is the link length, mode is 0o120755, ctime is the link's. Digest differs for every `.bin` entry and every pnpm-style linked package. More importantly, the fingerprint would stop changing when the target file changes, which is the one thing it exists to detect.

Fix: INV-01 must say metadata is `stat` of the resolved target for all entries, and the test must mutate a symlink target and assert the digest changes.

RESOLVED: Resolved symlinks use statSync of target; fixture includes file alias and mutates its target.

## 4. No acceptance criterion covers the stated intent

SEVERITY: high

Intent is "Stop can evaluate large projects within its existing budget". spec.md claims `next` takes about twelve seconds against the ten-second `spawnSync` timeout at `plugin-hook.mjs:47`. Nothing in the spec measures realpath's share of that. `gateCContext` calls `currentResults` twice (`commands.mjs:253` and `:256`), so `executionContext` runs twice per `next`, plus `treeDigest` writes a temporary git index for the whole repo, plus `indexDrift` runs three git commands. If the walker is 30% of the twelve seconds, the spec is satisfied and Stop still times out. "Measure the actual rsk0 tree after implementation" is a note, not a gate.

Fix: add an AC with a measured bound on the rsk0 tree, or add a profile to the spec showing realpath dominates, or explicitly state the perf goal is not acceptance-gated. Also note that the deliverable cannot meet the intent alone: the Stop hook runs the installed plugin cache at 0.16.0, so a release touching `package.json`, `CHANGELOG.md`, `marketplace.json` and both `plugin.json` files is required and none are in `allowed_paths`.

RESOLVED: Manual rsk0 full-hook and old/new same-digest profiling recorded; local installation manifests and package versions are in scope.

## 5. "Avoids per-file realpath" test can be satisfied without removing ancestor resolution

SEVERITY: medium

Scenario: implementer replaces `fs.realpathSync` with `fs.realpathSync.native`, or resolves each child with `fs.readlinkSync` plus a manual ancestor walk. A spy on `fs.realpathSync` counts zero calls. Assertion passes. Ancestors are still resolved per file. Separately, `realpathSync.native` on macOS APFS returns on-disk casing via `F_GETPATH`, while the JS `realpathSync` preserves input casing, so a `dependency_paths: ['Node_Modules']` config would change digest.

Fix: the test should assert the count of resolution calls is at most the number of root entries plus the number of symlinks in the fixture, with `realpathSync.native` spied as well, and the spec should pin the JS `realpathSync` for symlink resolution.

RESOLVED: Both JS and native calls counted; 200 directories and 200 files require exactly five resolutions.

## 6. Reference implementation is the only equivalence oracle and lives in the allowed test file

SEVERITY: medium

Scenario: the test copies the legacy walker into `test/execution-context.test.mjs`. During iteration the implementer "fixes" the copy to match the new output when a fixture disagrees. Both walk in lockstep, the test is green, receipts on real machines miss. Golden hashes are impossible because mtimes vary, so the copy is load-bearing.

Fix: spec should require the reference to be extracted verbatim from git history at commit `6527cc3` with the source commit named in a comment, and the AC should additionally assert tuple-level equality of the `deps` array, not only the final hash, so divergence is diagnosable.

RESOLVED: Reference identifies source commit and restores unchanged legacy walker/defaults; actual rsk0 comparison imports the source from git directly and confirms equal digest.

## 7. INV-01 "gate requirements remain unchanged" is untestable filler

SEVERITY: low

No gate requirement lives in `check-cache.mjs`. Listing it in an invariant for a walker change gives reviewers nothing to check and dilutes the real invariants. Same for "environment coverage", which is `childEnv` at line 22 and is untouched by the walk.

Fix: restrict INV-01 to the tuple shape `[file, real, size, mtimeMs, ctimeMs, mode]`, traversal order from `readdirSync(real).sort()`, and dedupe by resolved path.

RESOLVED: Invariant retained to explicitly prohibit acceptance/environment weakening; source diff leaves these unchanged.

## 8. Rollback note forbids what the spec may need

SEVERITY: low

"Do not ... cache dependency scans" rules out memoizing `executionContext` within one `next` invocation, yet finding 4 shows it runs twice there and twice more per cached check. If the walker rewrite alone does not clear the budget, the natural next step is precisely the one the rollback notes prohibit, and nothing explains why.

Fix: either state the reason (for example, detecting mid-check environment drift at `check-cache.mjs:49` requires a fresh scan) and scope the prohibition to the before/after pair in `cachedRunner`, or drop the note.

Out-of-scope check: no spec content contradicts the declared out-of-scope list. Walker stays a function of files on disk, no network, no UI.

RESOLVED: Spec explains fresh before/after scans detect mid-check mutations; measured walker alone meets observed hook budget.
