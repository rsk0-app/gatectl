# gatectl 0.16.1 — bounded Stop reminders

User requested publishing the locally reviewed hotfix as a supported release.
The prior ACTIVE pointer belonged to critique-remembers-its-own-rounds, included
in v0.14.0; its files and history remain intact, without a new completion claim.

A new status turn does not necessarily carry stop_hook_active. The hook therefore
records a reminder signature in a separate per-session reminder file (never in
task state or gate evidence): slug, enrollment timestamp, staged tree and complete
working tree including untracked files. Writes cannot overwrite pause or enrollment. An identical candidate gets an
explicit incomplete advisory. Changed code or fresh task enrollment rearms it.

Every invocation still evaluates next. Only finish establishes completion. Runtime
or environment changes can invalidate actual check receipts; this release does not
silently reuse them. A broken Git index returns the original blocking response.

Publish synchronized CLI/Codex/Claude 0.16.1 versions, regenerated offline bundle,
GitHub release archive, npm-format tarball and SHA256SUMS, following passed tests
and independent review. No npm-registry publication is implied: previous releases
ship these artifacts through GitHub.

Known bounds: concurrent Stop processes can produce duplicate reminders. Both Git
and reminder-storage failure preserve blocking. Git subprocesses share a four-second
budget; next is limited to ten seconds, within the existing 20-second host budget.
Synchronous local filesystem stalls cannot be strictly bounded by JavaScript. None alters finish or any required gate. Host processes are
not an adversarial enforcement boundary.

Check progress alone does not rearm a duplicate blocker. The advisory includes the
current next command and says completion is not established. Including next state
in the signature would restore repeated nudges when shell execution contexts differ.
Human-BLOCKED and completed paths never record a reminder.

Tests cover untracked changes with staged work, separate sessions, reenrollment,
post-completion changes, unmerged Git index, separate marker persistence and an
unwritable marker directory. Preserved failure behavior is tested as an invariant,
not assigned an invented RED obligation.

Publication is explicitly owner-authorized, after finish: artifact smoke checks,
checksums, push, CI, tag and GitHub release. Those external publication actions are
verified separately from gate receipts. Existing CI referee template pins remain
unchanged; this patch changes Stop reminders, not the referee contract.
