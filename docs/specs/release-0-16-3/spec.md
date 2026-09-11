# Release 0.16.3

Publish runtime 6da2cf1 under a new stable distribution version. Enrollment,
checks and finish run `node bin/gatectl.mjs` in this checkout (the accepted new
runtime), not the host's cached CLI. Before tagging, verify the accepted completion
contains input_context and attestation_mac and its final ledger entry binds its MAC.

CLI, lockfile, bundled package, Codex/Claude manifests, Claude marketplace and
first dated changelog entry must agree on 0.16.3. The exact release assertion
supersedes 0.16.2's no-test-edit convention: this release identity must fail on the
prior published base. Bare-semver, cross-artifact and dated-heading checks remain.

No runtime/policy change belongs in this stage. Before acceptance, require an
empty `git diff 6da2cf1 -- src bin plugins/gatectl/bin plugins/gatectl/skills
plugins/gatectl/hooks plugins/gatectl/templates` and successful
`npm run check:plugin`. Generate plugins/gatectl/package.json through the bundle
builder, never a hand-authored approximation; byte equality is required.

Release notes must describe signed recorded acceptance across host env, the need
for older accepted tasks to refresh via successful finish in their original
validated environment, unchanged timeout/policy/cache execution checks, and aligned
CLI/both plugins. Gate X reviews that content, not only the version heading.

After finish: commit metadata, build CLI tarball/plugin ZIP/checksums, push main
using devher0, verify CI, then push the tag and publish assets. Download and verify
checksums. No npm publication. Foreign-repo probe results are optional post-finish
operational verification, not release acceptance predicates. Retain them outside
this repository at /Users/nick/.codex/artifacts/gatectl-0.16.3/ and label the exact
bundle/commit used; never describe a dev-bundle probe as an installed-host test.

## Codex installation and the current development alias

This is a Codex session, not the critic's Claude session. `codex plugin list --json`
confirmed the installed gatectl 0.16.2 comes from the local gatectl marketplace and
this checkout's plugins/gatectl source. After release use `codex plugin add
gatectl@gatectl --json`, then verify installed version, physical path and bundle
bytes. The current thread references the development compatibility path
0.16.1+codex.20260910064758, which already contained 0.16.2 before this task; it is
not an immutable published-version directory.

Do not overwrite any bare-version cache's binaries. Replace only that historical
development compatibility directory with an explicit symlink to the new installed
0.16.3 directory, after backing it up outside the cache. Verify realpath, CLI
version and the hook response through the alias and report both paths. This makes
the compatibility mapping explicit instead of hiding new bytes behind an old
version label. New threads use the installed version entry; verification here
uses the installed CLI's SessionStart output, not a claim that a new UI thread was
opened. Do not change marketplace/config files by hand. No skills or MCP tools
change, and work can continue in this thread using the verified runtime alias.

## Rollback

Use a separate checkout of tag v0.16.2 or its published plugin archive. Configure
a separate version-pinned local marketplace through the plugin CLI/helper and
install from that source; reinstalling the main marketplace would fetch 0.16.3.
Verify CLI version and installed path, and explicitly retarget the development
compatibility symlink to that verified rollback installation (or restore its
backed-up directory). Keep existing bare-version cache directories intact.
Rollback restores the false post-commit Stop behavior; 0.16.3 completion records
remain readable by 0.16.2, which ignores the extra fields. Tags/assets/history
are retained and policy is never downgraded.
