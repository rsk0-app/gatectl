# Critique — stop-reminder-release

- provider: openai
- model: claude-fable-5-1
- round 1

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Hook read-modify-write can silently un-pause a user-cancelled task
SEVERITY: critical

Scenario. Stop hook reads session at `plugin-hook.mjs:39`, then spawns `next` (up to 15s), then writes `{...session, reminder}`. In that window user runs `task pause --session <id> --reason "user cancelled"` (`commands.mjs:458`). Hook rename lands last → `paused: true` gone. Next Stop blocks again. Spec promise "Preserve user cancellation" broken. Rollback note says race "cannot create gate PASS" — true, but wrong axis: race destroys pause, not evidence.

Fix. Never write session file from hook. Store reminder in sibling file `sessions/<hash>.reminder.json` (own atomic rename), or re-read session immediately before write and refuse write if `paused`/`at` changed. Add AC: pause issued between Stop read and write stays paused. Note `src/core/plugin-session.mjs` missing from allowed_paths — needed for either fix.

RESOLVED: Spec AC-02 now requires separate per-session reminder files. Hook will never write task session state, so a marker write cannot overwrite a pause or reenrollment. Enrollment timestamp is part of marker identity.


## 2. Storage failure fails open; contradicts INV-03 fail direction for git
SEVERITY: high

INV-03: git fingerprint failure → original blocking. Storage failure → "explicit incomplete advisory" (spec.md line 22). Advisory is non-blocking `systemMessage`. Scenario: state dir read-only (`GATECTL_STATE_DIR` perms, disk full, sandbox). First Stop: can't persist signature → advisory → agent stops. Every later Stop same. Reminder feature disabled with zero blocks, no code touched. Weaker than 0.16.0.

Fix. Storage write failure on first reminder → return original `decision: 'block'` plus note "reminder state unwritable". Advisory only when signature already persisted and matched. Reword INV-03: both failure classes preserve blocking.

RESOLVED: INV-03 now requires original blocking on both Git and reminder-storage failure. A broken marker directory is covered by the integration tests; only a successfully read matching marker may suppress a duplicate.


## 3. Untracked files do not rearm
SEVERITY: high

spec.md: signature = slug + "candidate tree and unstaged contents". Staged-mode `treeDigest` (`target.mjs:58`) = index only. "Unstaged contents" reads as `git diff` = tracked modifications only. Scenario: agent blocked with "missing RED test"; writes new untracked `test/x.test.mjs`; Stop. Tree same, `git diff` empty → signature identical → advisory, no block. INV-02 "code changes ... rearm" violated on exactly the first TDD step.

Fix. Signature must include `git ls-files --others --exclude-standard` names + content hash (or `git add -A` into throwaway index, which unstaged-mode `treeDigest` already does). Add AC: new untracked file rearms.

RESOLVED: The explicit signature now includes a full working tree built with git add -A in a throwaway index, including untracked contents, plus the staged tree. The test suite includes an untracked file while other changes are staged.


## 4. Progress without code change stays suppressed
SEVERITY: medium

Signature ignores `next.state`/`next_command`. Scenario: block says "Next: gatectl check". Agent runs check → receipts change, tree unchanged. `next` now says "gatectl review". Stop → same signature → advisory "remains incomplete", no next command. Agent stops one step from finish. Also reverse: BLOCKED (human question) path — if signature recorded there, answered question + unchanged tree → suppressed.

Fix. Include `next.state` and `next_command` in signature. Record signature only on the blocking path, not BLOCKED/advisory paths.

RESOLVED: Advisory will carry the current next_command and explicitly require continuing authorized work. Signature intentionally remains candidate/enrollment based: varying check/review states between shell environments must not recreate the reported loop. BLOCKED and COMPLETED responses never write a reminder, and checks without finish remain incomplete in tests.


## 5. Hook timeout on large trees fails open
SEVERITY: medium

hooks.json Stop timeout 20s. `next` spawn already 15s. Adding `treeDigest` (`git add -A` into temp index on unstaged mode, full tree) on large repo pushes past 20s. Claude Code drops timed-out hook output → Stop passes silently, no block, no advisory. Rollback note mentions cost only, not consequence.

Fix. Compute signature from cheap git ops (`git diff --cached` hash, `git diff` hash, `git status --porcelain=v2` hash), with own timeout. Timeout → treat as fingerprint failure → block (INV-03). Raise hooks.json timeout or lower `next` timeout so total < host limit.

RESOLVED: The spec now budgets next at 10 seconds and Git fingerprint subprocesses at 4 seconds total, plus root lookup at 1 second, below host timeout. Any fingerprint timeout preserves blocking. Synchronous filesystem stalls remain a documented host/runtime limitation.


## 6. INV-02 and INV-03 have no acceptance test
SEVERITY: medium

Single AC-01 covers same-session flow. No test for: second session on same repo independent; explicit `task start` re-enrollment rearms; git failure blocks; storage failure behavior (#2). Tier A (marketplace.json, plugins/** unmatched) makes untested invariants pure claims for reviewer.

Fix. Add AC-02 (untracked + enrollment rearm, two sessions), AC-03 (git failure → block; unwritable state dir → block).

RESOLVED: AC-01 test covers multiple sessions, reenrollment, unstaged and untracked edits, actual finish and post-finish changes. AC-02 adds a genuine RED obligation for separate marker persistence. Git/storage failures are preserved invariants with integration tests, not invented preexisting failures.


## 7. allowed_paths too narrow for stated design
SEVERITY: low

spec.md says signature stored "in session state". Schema owner is `src/core/plugin-session.mjs`, not allowed. Any fix for #1 or #3 touches `plugin-session.mjs` or `target.mjs` → gate C "changed outside allowed_paths". Also `templates/ci/gatectl-verify.yml` pins v0.16.0 and build-plugin copies it into `plugins/gatectl/templates`; `--check` fails if bundled copy diverges. Not allowed → new-install CI referee stays 0.16.0. Acceptable only if stated.

Fix. Add `src/core/plugin-session.mjs`, `src/core/target.mjs`, `templates/ci/**` or state pin stays 0.16.0 in spec.md.

RESOLVED: Separate marker storage can be implemented in plugin-hook.mjs using already-exported sessionPath; no session schema or target helper edits are needed. The specification explicitly leaves existing CI referee template pins unchanged.


## 8. Release publication steps unverifiable
SEVERITY: low

spec.md lines 16-19: GitHub release archive, tarball, SHA256SUMS. No script in allowed_paths, no AC, no gate. Finish exit 0 will not cover it; outward-facing publish happens after gate, unreviewed.

Fix. State in spec: publish is manual post-finish step by owner, outside gate evidence. Or add AC checking `npm pack` tarball version matches CLI.

RESOLVED: The specification now distinguishes policy-gated code completion from owner-authorized publication. Artifact versions, checksums, CI and published assets will be verified separately after finish; no claim that finish itself proves publication.
