# Critique — release-0-16-2

- provider: openai
- model: claude-fable-5-1
- round 1

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. AC-01 never names 0.16.2; GREEN reachable without releasing anything

SEVERITY: critical

Test at `test/release-version.test.mjs:5-11` reads root `package.json` version and asserts equality only. No literal, no shape check. Current tree: root, lock, bundled package, both `plugin.json` all say `0.16.1+codex.20260910064758`; only `.claude-plugin/marketplace.json:11` says `0.16.1`.

Scenario: implementer edits one line, marketplace.json → `0.16.1+codex.20260910064758`. RED→GREEN, gate C clean (file in allowed_paths), INV-01 trivially true, `finish` exit 0. Spec intent "publish as 0.16.2" unmet, completion claimed. Second variant: bump to `0.16.2+codex.<ts>`; test passes, tag `v0.16.2` mismatches every manifest, npm pack tarball name carries build metadata.

Fix: assert `version === '0.16.2'` literally (or `/^\d+\.\d+\.\d+$/` plus equality with first `## ` heading in CHANGELOG.md). Add statement to AC-01: "release version is bare semver 0.16.2".

RESOLVED: Test enforces bare semver and top dated changelog equality. Spec names 0.16.2, and all six concrete distribution versions are 0.16.2; publication verified post-finish.

## 2. Spec silent on `+codex.<timestamp>` build-metadata policy; test as written turns every local cachebuster commit into CI failure

SEVERITY: high

Commit 68169cf introduced `+codex.20260910064758` as cache-busting suffix; its critique resolution (`docs/specs/execution-context-walk/critique.md:74`) requires "fresh cachebuster and reinstall" on rollback. That workflow stamps root `package.json` and regenerates plugin manifests but not marketplace.json.

Scenario after 0.16.2 ships: dev runs cachebuster for local Codex test, commits per prior spec's procedure, pushes main. `.github/workflows/test.yml:24` runs `npm test` → new test red on main. Alternative: dev also stamps marketplace.json with `0.16.2+codex.<ts>`; Claude marketplace cache path becomes `~/.claude/plugins/cache/gatectl/gatectl/0.16.2+codex.<ts>/`; `+` in path untested, and every stamp forces marketplace churn.

Fix: spec.md must state one rule: committed versions are bare semver; build-metadata stamps are local-only and never committed, or test compares semver core only and a separate check forbids `+` in committed manifests. Pick one, write it in spec.yaml as invariant.

RESOLVED: Spec explicitly requires bare semver in public release commits; local cachebuster edits must be reverted before release.

## 3. INV-01 has no verifier and allowed_paths `plugins/gatectl/**` permits runtime edits

SEVERITY: high

`plugins/gatectl/**` covers `bin/gatectl.mjs` (full bundled CLI), `skills/**`, `hooks/hooks.json`, `templates/**`. Gate C passes any edit there. No AC runs `npm run check:plugin`; CI does it (`test.yml:23`) but CI is post-finish and not a gate.

Scenario: implementer regenerates bundle with dirty `src/` or wrong esbuild, commits changed `plugins/gatectl/bin/gatectl.mjs`. Test passes, gate C passes, `finish` exit 0. Release 0.16.2 ships runtime not equal to 68169cf. INV-01 violated, undetected.

Version bump does not require bundle regen: `src/cli/commands.mjs:37` reads version from `package.json` at runtime, esbuild `define` only sets `GATECTL_BUNDLED`, so `plugins/gatectl/bin/gatectl.mjs` must be byte-identical to HEAD.

Fix: narrow allowed_paths to `plugins/gatectl/package.json`, `plugins/gatectl/.codex-plugin/plugin.json`, `plugins/gatectl/.claude-plugin/plugin.json`. Add policy-verified criterion: `git diff 68169cf -- plugins/gatectl/bin plugins/gatectl/skills plugins/gatectl/hooks plugins/gatectl/templates src bin` empty, and `npm run check:plugin` exit 0.

RESOLVED: Allowed paths narrowed to three plugin metadata files. Runtime diff against 68169cf is empty and build:plugin --check is required before acceptance.

## 4. Rollback "Install published 0.16.1" does not exist as operation for marketplace channel and reverts the motivating fix

SEVERITY: medium

`.claude-plugin/marketplace.json:9` source is `./plugins/gatectl` on main, no version pin. Once main is 0.16.2, "install 0.16.1" via marketplace means revert main or point marketplace add at tag checkout; spec says neither. Codex path: `codex plugin add` keys cache by version, host with 0.16.1 cached from public release keeps that bundle, fine, but that bundle lacks the walker fix from 68169cf. Rollback re-introduces Stop timeout that motivated release. This machine's hook already runs cache `0.16.0` while marketplace says `0.16.1`: marketplace bump alone never refreshed Claude cache, so "install locally" step in spec.md has no verifier either.

Fix: rollback strategy names concrete commands per host (Codex: `codex plugin add` from `v0.16.1` tag checkout; Claude: `claude plugin marketplace add <path at v0.16.1>` then reinstall), states known cost (walker fix lost), and states cache eviction requirement.

RESOLVED: Spec describes separate tag checkout and host reinstall with cache refresh; rollback explicitly loses timeout optimization.

## 5. Intent deliverable (tag, assets, checksums, publish) unverifiable by any gate; finish exit 0 precedes publish

SEVERITY: medium

spec.md lists: npm pack tarball, plugin zip, SHA256SUMS, push main, immutable tag, wait CI, publish release, download and compare hashes, install locally. None in spec.yaml. `finish` exits 0 after AC-01 GREEN with nothing published. Completion claim "Publish ... as 0.16.2" false at that moment. Any attempt to gate these steps would read GitHub → violates out-of-scope "gate reading from network service".

Out-of-scope check: spec content itself does not contradict declared list; release steps are manual, not gates. Must stay that way.

Fix: spec.md states explicitly: finish attests version alignment and changelog only; publish is manual post-finish checklist, not part of completion claim. Move publish list into "post-finish procedure" section.

RESOLVED: Intent and prose now distinguish local preparation acceptance from post-finish publication verification.

## 6. CHANGELOG uncovered; INV-01 claims release notes change but nothing checks it

SEVERITY: medium

`CHANGELOG.md` in allowed_paths, no criterion. `CHANGELOG.md:3` top heading is `## 0.16.1 — 2026-09-10`.

Scenario: implementer bumps six version fields, skips changelog. AC-01 GREEN, finish exit 0. Release 0.16.2 shipped with changelog saying 0.16.1; npm tarball includes CHANGELOG.md per `package.json:49`.

Fix: extend test: first `## ` heading in CHANGELOG.md parses to same version as package.json and carries date. Or add policy-verified AC-02.

RESOLVED: Test checks first dated changelog heading equals package version.

## 7. Shipped CI template pins referee v0.16.0; spec silent

SEVERITY: low

`templates/ci/gatectl-verify.yml:48,87` pin `ref: v0.16.0`; copied into `plugins/gatectl/templates/ci/gatectl-verify.yml`. `templates/**` not in allowed_paths; `check:plugin` fails if only bundled copy changes. Release 0.16.2 ships referee pin two versions behind. Prior critique (`docs/specs/stop-reminder-release/critique.md:74-76`) said acceptable only if stated. Not stated.

Fix: one line in spec.md: "CI template referee pin stays v0.16.0 in this release; bump in separate reviewed commit."

RESOLVED: Spec explicitly retains referee v0.16.0 for this metadata-only release.

## 8. Test resolves paths from cwd, not repo

SEVERITY: low

`test/release-version.test.mjs:5-11` uses relative `'package.json'` etc. Works under `npm test` from root and `npx vitest run {file}` from target root. Breaks if vitest invoked from subdirectory or `root` option changes; failure mode is ENOENT, class `load`, not `assertion`, so RED classification flips.

Fix: `const root = fileURLToPath(new URL('..', import.meta.url))` and `path.join(root, file)`.

RESOLVED: Test resolves root from import.meta.url.
