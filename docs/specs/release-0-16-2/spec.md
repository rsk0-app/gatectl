# gatectl 0.16.2

Publish the accepted walker optimization from 68169cf as a stable GitHub release. Align both plugin manifests, CLI/lockfile, bundled runtime and Claude marketplace version. Add a regression preventing marketplace cache keys from drifting from the actual distributed version; current local build differs from the Claude marketplace and genuinely fails this regression.

Ship npm pack tarball, plugin zip and SHA256SUMS. Push main and immutable v0.16.2 tag, wait for Tests and plugin bundle CI, publish release with the exact assets, download and compare hashes, then install locally. No policy changes and no additional runtime edits. Public npm registry publication is outside scope.

Public release commits use bare semver consistently; development cachebuster stamps must stay local and be reverted before public release commits. The regression compares bare semver with the top dated changelog entry, allowing future stable releases without editing the test. For this release the concrete version is 0.16.2.

The allowed paths exclude bundled executable, skills, hooks and templates. Before acceptance verify git diff 68169cf -- src bin plugins/gatectl/bin plugins/gatectl/skills plugins/gatectl/hooks plugins/gatectl/templates is empty, and npm run check:plugin succeeds. The CI template referee stays v0.16.0; no template bump in this task.

Finish attests local version alignment/release preparation only. Post-finish procedure: commit and push main, confirm CI success for that exact SHA, create immutable tag, publish archives/checksums, download and verify, reinstall and confirm CLI version/bundle. Publication is not a network-reading policy gate and is reported separately.

Rollback for a host requires a separate checkout at v0.16.1, configuring its marketplace and reinstalling from it, removing the affected local version cache if required. This loses the walker optimization and can restore the Stop timeout. It never moves/deletes published tags.
