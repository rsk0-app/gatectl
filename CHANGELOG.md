# Changelog

## 0.16.2 — 2026-09-10

- Dependency fingerprints resolve configured roots and symlinks once, carrying resolved parent paths into ordinary children. This reduces repeated filesystem work in large projects without changing receipt inputs.
- Preserve target metadata, alias/cycle deduplication and omission of inaccessible or missing entries. Regression tests compare the previous fingerprint algorithm and prevent per-file/per-directory ancestor resolution.
- On the rsk0 development tree, the same dependency fingerprint took 1.09 seconds instead of 4.58 seconds; Stop completed within its existing timeout. Timings depend on the machine and project.
- Hook timeouts, environment coverage and completion requirements are unchanged. CLI, both plugin manifests and marketplace versions are aligned.

## 0.16.1 — 2026-09-10

- Stop reminders are bounded across separate status turns for an unchanged candidate. Advisories remain explicitly incomplete and include the current next command. New code or explicit enrollment rearms the reminder.
- Reminder files are separate from task state, so a hook cannot overwrite a user pause or reenrollment. They are never gate evidence.
- Both staged and working trees, including untracked files, participate in reminder identity. Git and marker-storage failures preserve blocking; Git subprocesses share a bounded budget.
- CLI and both bundled plugins carry the same fix. Check receipt validation and finish requirements are unchanged.

## 0.16.0 — 2026-09-07

- Fast local workflow is the new-project default: related tests during edits, one final check pipeline, independent review and explicit finish. Existing policies stay unchanged until owner opt-in.
- Signed command receipts reuse exact successful executions across GREEN/full checks and invocations. Code, environment, command, policy and configured dependency/input metadata changes invalidate them; `--fresh` bypasses reuse and failed reruns invalidate prior success.
- Fast follow-up reviews receive the delta and prior report, preserve unresolved findings and still account for all criteria. Unchanged candidates reuse their review; `--full` requests a complete review.
- Readable commands replace gate abbreviations in the normal flow; old commands and ledger keys remain compatible. `next`/`finish` do not execute checks.
- Claude reviewers now use print mode with read-only tools by default, instead of receiving Codex flags.
- Both bundled plugins teach the fast loop; strict RED and independent verification remain explicit choices.

## 0.15.0 — 2026-09-07

Repository tasks can run through gatectl from Codex or Claude Code plugins.

- One self-contained plugin has both manifests, a shared delivery skill, an offline bundled CLI,
  and SessionStart/UserPromptSubmit/Stop hooks. Setup opts in a repository; session enrollment
  scopes completion reminders to implementation work. A pause never creates completion evidence.
- `init --client codex|claude` configures the other CLI as critic/reviewer for new policies. Existing
  policies are preserved, and enrollment refuses a mismatched implementer.
- Review acceptances bind to the exact review digest, specification and tree, including criterion
  exceptions. Reused ids/titles and legacy unbound acceptances cannot clear a later review.
- Active spec directories no longer bypass meta-class checks. Only the exact lock artifact
  recorded by gate L can be excepted locally. Gate C checks scope for every tier.
- Gfull runs the declared typecheck as well as build/tests. Command gates reject index drift
  before execution and do not stamp a changed tree as tested.
- `next` and `complete` honor effective-tier requirements. `verification: policy` allows explicit
  policy-only criteria; escalation to a tier requiring R refuses missing test obligations.
  Completion records distinguish policy-gate acceptance from criterion RED/GREEN proof.
- The verifier runs typecheck and reports only command checks actually executed; full gates stay
  in `not_rerun`. Compiled-spec digests retain their canonical meaning in issued records.
- New CI installations pin the public gatectl v0.15.0 referee instead of a placeholder repository.
- Regression coverage includes stale exceptions, protected locks, light-tier delivery, plugin
  cache isolation, bounded Stop behavior and stale completion after edits.

Migration: declare typecheck (or a justified `none`), refresh old lock/exception evidence, and
update issued-verdict consumers to use the command-check labels. No existing target policy is
rewritten by upgrading.

## 0.14.0 — 2026-08-20

Gate X stops paying for findings and starts requiring coverage.

- **The reviewer accounts for every id, or the review is incomplete.** Every acceptance criterion
  and every invariant in the compiled spec must appear in the review with a verdict. The old rule
  — "a review that found nothing is NOT_EVALUATED" — was aimed at the right problem and paid for
  the wrong thing: it rewarded invented nits. Finding nothing is now legitimate; having looked at
  nothing is not, and the difference is checkable.
- **Citations are verified against the code.** A claim carries file, line span and the exact
  quote; gatectl reads those lines and refuses the review if the quote is not what is there. A model
  cannot compute a git blob id, so it is not asked to — it quotes, and gatectl stamps the digests.
  This closes citing a line number that exists but says something else.
- **At least one citation must land in the diff**, or the review is not about this change.
- **A criterion the reviewer marks `unclear` or `not_implemented` is not green.**
- **Findings carry stable ids.** Fixing one changes the code, which stales the review and forces
  a fresh one — no bookkeeping needed. Accepting one is the case that does need writing down:
  `rda review accept X-001 --reason "…"` records it in the signed ledger, and gate X then passes
  and says so, so the record still answers why a known problem shipped.
- The review is JSON in the state directory, not Markdown in the repository — a review of a tree
  must not change the tree it reviewed, and a structured account is the only kind a gate can
  check without reading prose.
- README states plainly which half of gate X is deterministic (the binding, the coverage, the
  citations, the finding handling) and which is not (whether the reasoning is any good).

## 0.13.0 — 2026-08-20

The spec stops being prose the gates guess at, and RED stops being a memory.

- **`spec.yaml` and `rda spec compile`.** The source of truth is machine-readable: stable
  criterion and invariant ids, a test reference on every criterion, a canonical form and a digest
  over it. The compiler refuses by name what a gate would otherwise have to guess at — a
  criterion with no test, two criteria naming the same case, a duplicate or malformed id, an
  empty `allowed_paths`, a rollback with no strategy. Markdown specs still work; they simply
  digest over their bytes, which is the imprecision this removes.
- **The digest is over the canonical form.** Reformat the YAML, reorder keys, edit a comment —
  every gate result stands. Change a statement, and everything bound to the old digest is stale.
- **The Test Obligations Manifest.** One entry per criterion, naming the exact run that proves
  it. Gate R and the Completion Authority read this and nothing else; neither parses prose.
- **`rda red --base <sha>` replays.** Gate R rebuilds the base commit in a throwaway worktree,
  copies in only the test half of the diff, and runs each criterion there. The property that
  matters: it still works after the implementation has landed, so RED becomes an experiment
  anyone can repeat from git rather than a claim about a tree that no longer exists. Evidence is
  recorded per criterion, with the replayed tree's own OID.
- **Per-criterion RED kinds.** `expected_red: assertion` is the strict default; a criterion whose
  honest first failure is a missing export can declare `load` instead of faking an assertion. A
  failure of any other kind is NOT_EVALUATED — a broken harness is not a red test.
- **`rda green`** records the other half: every criterion's test, on the tree in front of us,
  required to pass, and refusing the same lie (a run that matched nothing exits 0).
- **The Completion Authority now reads evidence instead of producing it.** Seven predicates, and
  the pair is the point: RED alone is a test nobody made pass, GREEN alone is a test that may
  never have been able to fail. Both, per criterion, by stable id.
- **`rda next [--json]`.** The state is derived from the compiled spec, the signed ledger and the
  tree — never stored, because a status an agent can write is one it will write the moment it
  feels done. Edit the tree after GREEN and the state falls back to IMPLEMENTING; weaken a
  required test and it falls back to LOCKED; an open BLOCKING question stops the protocol and
  offers no command at all.
- README no longer contradicts itself: gate X and the Completion Authority run, and the sections
  describing them say what they do and what they do not.

## 0.12.0 — 2026-08-20

The trust boundary moves from "who holds the key" to "who is allowed to be believed".

- **The job that runs the repository's code no longer holds the key.** `pnpm install` alone
  executes lifecycle scripts from the branch under test; a signing key in that environment is a
  key that branch can print. The shipped workflow is now two jobs: `run` (no secrets at all,
  writes an unsigned evidence envelope into `RUNNER_TEMP`, not the workspace) and `attest`
  (holds the key, executes nothing from the repository).
- **The signer does not believe the evidence.** Splitting the jobs alone would only move the
  attack from stealing the key to handing over a forged PASS. Every cross-checkable field —
  repository, workflow run id and attempt, head and base commit, tree OID, both policy digests —
  is re-derived from the signer's own GitHub context and from git. Command results are attested
  as "the runner said this", never as "this is true", and the printed verdict says so.
- **Unknown envelope fields are refused, not ignored**: a field the signer cannot check must not
  ride along inside a signature.
- **Authority comes from the base commit.** `verify --base <sha>` reads the policy from the
  commit the pull request branched from. A branch that edits `.rda/policy.yaml` — its tier, its
  required gates, the commands that stand for "the tests" — is refused before anything runs:
  `candidate modifies its own authority`. The base commit is immutable, where a branch name
  would be a race between the run and the signature.
- **Every command gatectl runs now gets a scrubbed environment**: `RDA_SIGNING_KEY`,
  `RDA_ATTEST_KEY` and `GITHUB_TOKEN` are removed unless policy names them. This was a real hole
  — `runCmd` inherited gatectl's whole environment, so a `postinstall` could read the key.
- **`test/attack.test.mjs`**: eighteen attacks, written as attacks. Delete the required test, add
  `.only`, name a case nobody wrote, exit 0 without running, read the key from a test command,
  inject a command through a filename, edit code after G-full, leave an unstaged edit, edit the
  policy or the workflow, forge a ledger entry, invent one for a gate that never ran, hide
  tier-A code under a wide glob, forge the envelope, replay another run's artifact, smuggle an
  extra field, relax the judging policy. Each has a named answer.
- README states the two limits this does not close: a runner executing repository code can still
  lie about results until it is sandboxed, and gate X does not yet run inside the verifier.

## 0.11.0 — 2026-08-20

CI becomes the issuer. The local record stops pretending to be proof.

- **Ed25519 verdicts.** HMAC is symmetric: to check one you need the key that makes one, so
  every verifier was a potential forger and the key had to spread to anyone who wanted to check.
  Issued records are now signed with Ed25519 — the private half signs, the public half only
  checks, and `.rda/attest.pub` can be committed and read by anyone. The local `commit-check`
  record stays HMAC deliberately: it is a claim addressed to its own author, and it is now
  described that way everywhere.
- **`rda verify --rerun --issue`.** After re-running a commit's gates on a clean checkout, the
  runner signs what it found. `--issue` without `--rerun` is refused: signing a claim someone
  else made would lend it this key's authority for nothing.
- **The issuer needs no local state.** No ledger, no attestation, no key beyond
  `RDA_SIGNING_KEY`. It reads the spec, the policy and the diff from the commit itself, and when
  no local claim exists it says so rather than treating its absence as agreement.
- **A verdict states its own reach.** `reran` lists what was actually executed; `not_rerun` lists
  the required gates it could not redo — a CI runner has no model for gate X and no ledger for L
  or R. A verdict that implied otherwise would be the failure this engine exists to prevent, one
  level up.
- **`rda keygen`** writes the pair, refuses to overwrite an existing key without `--force`
  (every verdict signed by the old one would stop verifying), and prints the two commands that
  move the private half into CI and delete the local copy.
- **`rda init --with-ci`** ships `.github/workflows/rda-verify.yml`, and `meta_class` now covers
  it: an agent editing its own referee fails gate G-full. The workflow installs gatectl from a pinned
  external source, because a referee shipped by the branch it referees is not a referee.
- A public key taken from the repository is used but announced as untrusted — anyone who can
  commit can swap it. `--pubkey` and `RDA_ATTEST_PUBKEY` are the trusted paths.
- git's own "fatal:" lines no longer leak into a verdict: a commit that carries no such file is
  an answer, not an incident.

## 0.10.0 — 2026-08-20

The Completion Authority. `commit-check` answers a question about a commit; this answers one
about a feature.

- **`rda complete`** decides whether what the spec promised is actually delivered: every
  criterion has a test, every one of those tests now *passes* (the named case, where one is
  named), gate C is green for this exact state, and the attestation is for the tree in front of
  it. Six predicates, all evaluated, each named on failure — a report that names one problem
  when there are four costs three more rounds of asking.
- `every_criterion_is_green` is gate R inverted and refuses the same lie: a run that matched
  nothing exits 0 in some runners, and "nothing ran" is not "it works".
- ACCEPT is the absence of failed predicates, never a positive opinion. The decision is signed,
  written beside the ledger and recorded in it, so a REJECT is as permanent as an ACCEPT.
- `commit-check` and `complete` now share one gate-C evaluation. A NOT_EVALUATED there is
  returned unchanged rather than rendered as a decision: an untrustworthy ledger produces no
  completion decision at all.

## 0.9.0 — 2026-08-20

Verification stops taking gatectl's word for it.

- **`rda verify --rerun`.** Checking a signature proves the record was not edited; it says
  nothing about whether the commit still passes. `--rerun` checks the commit out into a detached
  worktree, reads the policy that commit carries, and runs its `install` (if declared), `build`
  and `test_all` there. Nothing about the current checkout, the working tree or gatectl's state can
  reach it. A commit whose suite does not actually pass now fails verification even though its
  attestation verifies perfectly — the case a signature check alone cannot catch. The worktree is
  removed afterwards, including on failure.
- **Attestations record their environment**: node version, platform, arch, and the policy's
  commands as written, digested. A green earned with `test_all: "true"` and one earned with a
  real suite no longer look alike in the record. `verify` reports a difference rather than
  failing on it — verifying somewhere else is the point of verifying.
- Policy gains an optional `install` command, used only by `--rerun`: dependencies are not in
  git, so without it a re-run fails on a missing `node_modules` rather than on the code.
- An absent `build` or `test_all` at the commit makes `--rerun` answer `NOT_EVALUATED`, never
  pass: a commit that cannot be re-run independently has not been independently verified.

## 0.8.0 — 2026-08-20

Gate `X` exists. Tier A can reach a green `commit-check` for the first time.

- **`rda review` runs a second model over the implementation diff**, held to the locked spec and
  its invariants. It is told what NOT to report — formatting, style, whether the suite passed,
  whether the diff stayed in scope — because gatectl already decides those deterministically, and a
  model repeating them buries the findings only a model can produce.
- **`rda gate x` reads that review by fixed rules**: severity plus an unresolved marker. Same
  split as `critique`/`lock` — the model writes, the gate decides, and a human resolves a finding
  in writing with a `RESOLVED:` line.
- **Four ways it refuses instead of passing.** No `reviewer:` block in policy (never satisfied by
  whatever CLI happens to be installed); a review that found nothing (finding nothing is not
  approval — the same rule gate L has had since the start); a review of a different tree than the
  one in front of it; and the same model having critiqued the spec and reviewed the diff, which
  is one opinion twice rather than a cross-model review.
- **The review is written outside the repository.** A review of a tree must not change that tree:
  saved into `docs/specs/`, it would move the working state the moment it was written and stale
  the `G-full` that had just gone green over the exact diff under review. It lives beside the
  ledger, in the state directory.
- The shipped policy template gains a `reviewer:` block, and README no longer says tier A cannot
  go green.

## 0.7.0 — 2026-08-20

The two P0s from the same external review as 0.6.0: an engine that stores its own evidence where
the agent can rewrite it is a guardrail, not an authority — and a gate R bound to a test *file*
proves less than it appears to.

- **The ledger left the repository.** It lived at `docs/specs/<slug>/gates.json`, append-only by
  discipline, in a directory the agent being gated could write. It now lives under
  `~/.rda/state/<repo>/features/<slug>/gates.jsonl`, outside the target entirely, with a signing
  key at `~/.rda/state/keys/<repo>.key` (mode 0600). `RDA_STATE_DIR` and `RDA_ATTEST_KEY`
  override both; `rda init` prints where they are, because a trust boundary nobody can see is one
  nobody can check.
- **Entries are MAC-chained.** Each carries an HMAC over its own body and over the previous
  entry's MAC, so editing, deleting or reordering one invalidates every entry after it. A ledger
  that does not verify is not read: gate C answers `NOT_EVALUATED`, never `FAIL` and never
  `PASS` — nothing can be concluded from a record that was edited.
- **A green `commit-check` now writes a signed attestation**: tier, requirements, spec digest,
  policy digest, tree OID, ledger head, and which gates went green over exactly that state.
- **New command: `rda verify --commit <sha>`.** It trusts nothing gatectl wrote except the signature.
  Spec and policy are read *at that commit*, the tier is re-derived from the paths that commit
  actually changed, and the required gates from that commit's policy. Replay onto another tree, a
  moved spec, a loosened policy, an edited attestation and a wrong key are each refused by name.
  With `RDA_ATTEST_KEY` this is a CI check no worker agent can satisfy by editing files.
- **`rda init --with-hooks` now installs a pre-commit hook** that refuses a commit gate C has not
  passed. It stands aside when no feature is ACTIVE — it gates features, not the repository — and
  it is still a hook, so `--no-verify` walks around it. That is what the CI-side verify is for.
- **The tree digest has no exceptions any more.** The ledger had to be excluded from it while it
  lived in the repository, because recording gate L changed the tree gate R would later see.
  Out of the repository, the exception went with the problem: the bound OID is the commit's tree,
  exactly.
- **Gate R can bind to a case, not just a file.** An acceptance criterion may be written
  `required: test/auth.test.ts::"rejects an expired refresh token"`, and gate R runs that case
  through the new `test_case` command, once per criterion. Without a `test_case` command such a
  criterion is `NOT_EVALUATED`: running the whole file would answer a different question and
  record it under this criterion's name.
- **New failure class `empty`, and it is the one that matters.** `vitest run file -t "no such
  case"` **exits 0** having run nothing — verified by running it, not assumed — which a naive
  reading reports as "this test already passes". Exit codes are now classified on both paths: an
  empty run is `NOT_EVALUATED` whatever it exited with, and when a policy defines no `empty`
  patterns, an exit-0 named case is reported as the ambiguity it is rather than as a silent
  verdict either way.
- Detection writes `test_case` per runner (`-t` for vitest and jest, `--grep` for mocha,
  `--match` for ava) and leaves it unset for runners that have no single-case form — unset means
  unknown, and the gate refuses rather than substituting a whole-file run.
- Pre-0.7 in-repo ledgers are named and ignored rather than silently skipped: `commit-check`
  prints that `docs/specs/<slug>/gates.json` is no longer read, and the gates want re-running.

## 0.6.0 — 2026-08-20

Two holes found by external review of the v0.1 design, both of the same shape: the gate was
binding to something adjacent to what it claimed to be judging.

- **A gate now binds to the tree the commit will carry.** `git commit` writes the index;
  `treeDigest` hashed the working tree. With anything staged, the two can differ — stage a
  subset, keep editing, and `commit-check` verified bytes the commit would not contain. With
  something staged the digest is now the real tree OID of the index, which is the OID the next
  commit gets: checkable afterwards against a commit SHA with nothing but `git`. With nothing
  staged the behaviour is unchanged (whole working tree), because there is no commit shape yet.
  The real index is never touched — staged mode works on a copy, via
  `update-index --force-remove` rather than `git rm --cached`, which refuses outright on a
  ledger that differs from both HEAD and the working tree.
- **The other half of the same hole: `commit-check` now FAILs on index drift.** The gates run
  their commands against the working tree. Once something is staged, a green is only honest if
  the working tree and the index agree, so unstaged edits and untracked files are named and the
  gate goes red. Drift is reported, never repaired: staging on the agent's behalf would be the
  gate editing the commit it is judging. The ledger is exempt, for the same reason it is exempt
  from the hashed tree — it moves on every recorded gate, by design.
- **The tier is recomputed from the actual diff.** It was taken from the spec's `Allowed Paths`
  alone, so `src/**` (tier B) covered `src/lib/auth/**` (tier A) and a feature could be
  critiqued, locked and committed at B ceremony while shipping A-tier code. The effective tier
  is now the higher of declared and actual; it only ever escalates, and an escalation
  invalidates the lock by name (`tier escalated B → A … re-lock at A`). `rda status` reports it
  before `commit-check` does.
- The engine's own bookkeeping — the feature's spec dir, `docs/specs/ACTIVE`, and `meta_class`
  paths — is excluded from that computation. Those files move during every normal cycle, and at
  `init` time `.rda/policy.yaml` is itself an unmatched new file: counting them would escalate
  every first feature in every repository to tier A, and an escalation rule that always fires is
  the same as no rule. Touching a meta-class file is already a named `G-full` failure.
- **Gate `C` is no longer listed as its own precondition.** The shipped policy template wrote
  `requires: [L, R, Gfull, X, C]`; `commit-check` *is* gate C, so a green C could never precede
  producing one. `commit-check` already filtered it, and still does — an existing policy that
  lists `C` keeps working — but the template no longer advertises a requirement that cannot be
  met.
- The escalation rule found a real gap in this repository's own policy within a minute of
  shipping: `bin/**` and `templates/**` matched no tier at all, so any change to them failed
  closed to tier A. They are tier B now — except `templates/policy.yaml`, which is the default
  ceremony for every target `rda` is installed into and is tier A on purpose.
- README now states the limits of v0.1 plainly: the ledger still lives in a worktree the agent
  can write, nothing enforces that `commit-check` ran, gate `R` binds per test *file* rather
  than per case, gate `X` does not exist, and evidence records outcomes without the environment
  that produced them. What is deterministic is the gate *aggregation*, not the commands under it.

## 0.5.1 — 2026-08-20

Found by running the engine against a second target, which is where it was always going to
surface: this repository's own typecheck is declared `none`, so the reporting path for a failing
command had never once run here.

- **A failing gate now shows why it failed.** Reasons carried `output.slice(-400)` over stdout
  and stderr concatenated. `tsc` writes its diagnostics to stdout while node writes a
  ~350-character `ExperimentalWarning` to stderr, so the tail window was consumed by the warning
  and the printed reason was exactly `'.` — thirty-nine type errors reported as two characters
  of punctuation. A FAIL whose cause is invisible is barely better than the `NOT_EVALUATED` this
  engine exists to keep distinct from it.
- `runCmd` now returns `stdout` and `stderr` separately as well as combined. The combined
  `output` still feeds failure classification, because gate `R` must match a RED pattern
  wherever the runner chose to print it; reporting needs to know which stream a line came from.
- Both streams are excerpted and both are shown, and the excerpt keeps the **head as well as the
  tail**, declaring the gap. The two ends carry different halves of the answer: compilers put
  the first failures at the top, test runners put the summary at the bottom, and a window over
  one end throws away whichever half the tool in front of you uses. Nothing is filtered —
  dropping a stream to make the output tidy is the same failure mode one level down.
- A command that fails with no output at all now says `(no output)` rather than printing an
  empty reason, and a `run` implementation that predates the split still has its combined
  output honoured.

## 0.5.0 — 2026-08-20

Found by running `rda` against `rda` itself, which is the only way it was ever going to surface.

- **A command may now be the literal `none`.** Policy had one empty state doing two jobs: a
  command nobody filled in and a command for a step the project genuinely does not have. Both
  read as missing, so both made the gate answer `NOT_EVALUATED` — and any plain-JavaScript
  repository with no bundler and no TypeScript could therefore never reach a green `G-fast` or
  `G-full`. `none` is the owner declaring absence in a meta-class file agents never edit; the
  gate skips the step and prints the skip, so a green that ran everything and a green that
  skipped one do not look alike. Missing still means unknown and still refuses.
- `test_file` is deliberately never `none`: gate `R` drives every required test through it, and
  skipping there would mean never confirming RED.
- **Detection makes the same distinction from evidence.** A `package.json` that exists and names
  no build script is proof of absence, so `init` writes `build: none`. No manifest at all still
  writes nothing and leaves the gate refusing.
- Documented CodeGraph registration as a one-time human call, with the boundary enforced by
  `test/readme-codegraph.test.mjs` rather than by prose: it fails if any file under `src/`
  mentions CodeGraph.
- This repository now uses `rda` on itself. `.rda/policy.yaml` is generated by `rda init`;
  `.rda/MVP.yaml` is owner-approved.

The dogfood run in full: `rda init` read npm and vitest off the manifest and declared build and
typecheck `none`; the feature derived tier B from its allowed paths; the critic found ten
weaknesses in a two-line documentation change, seven of them critical or high, three of which
were real holes — an undefined endpoint, an unenforceable invariant, and a placeholder
out-of-scope list; and after resolving them `L`, `R`, `G-full` and `C` all came back green.

## 0.4.0 — 2026-08-20

`rda init` now writes a policy the target can actually run, instead of one someone has to
hand-edit before the first gate works.

- **Toolchain detection.** The package manager comes from the lockfile, the test runner and its
  per-file and related-file syntax from declared dependencies, `typecheck` from TypeScript's
  presence, `build` from a declared build script. Cargo, Go and pyproject targets are read too.
  Offline and evidence-based — every value is concluded from a file that exists — and `init`
  prints what each conclusion rests on.
- **What cannot be concluded is written commented out, not guessed.** `cargo` has no per-file
  test invocation, so a Rust target gets no `test_file` and gate R answers `NOT_EVALUATED` until
  a human supplies one. A wrong command that exits `0` is worse than no command at all.
- **Tier paths are reported, never edited.** An earlier draft pruned patterns matching nothing.
  A test caught what that meant: delete `supabase/migrations/**` from a repo without supabase,
  add supabase next month, and the migrations land in a lower tier with nothing announcing the
  downgrade — the same silent failure as auto-assigning sensitivity, deferred. `init` now
  reports which patterns match and which do not, and leaves all of them in place.
- `init` still never overwrites an existing policy, so detection cannot rewrite decisions a
  target has already made.

Verified live on three real trees: gatectl itself (npm + vitest, no build script and no TypeScript —
both correctly left unset), a Next-like repo (pnpm + jest + TypeScript, all five commands
detected, five tier-A patterns reported for confirmation), and a Cargo project.

## 0.3.0 — 2026-08-20

Recall now works, and export no longer depends on anyone remembering to run it.

- **Recall goes through gatectl's own index page instead of the service's search.** `/wiki/search`
  and `/wiki/page/ls` both answer `code: 0` with zero results for any wiki that is not `ready`,
  and `ready` arrives only after an LLM ingest run — so on a wiki gatectl had merely written to,
  recall could never return anything, and 0.2.1 could only explain the silence, not end it.
  `/wiki/page/read` has no such gate, so `rda export` now maintains `rda/_index.md`, one line
  per feature, written in the same atomic batch as the feature's page. Recall reads it, ranks
  locally by word overlap with the active spec's intent, and reads the winners by ref. No LLM
  anywhere in the path, and matching is a deterministic function of text gatectl wrote.
- Removed `searchMemory` and `wikiStatus`. One read path that works beats two where the better
  one is unreachable without someone else's infrastructure.
- **Added `rda init --with-hooks`** — installs a `post-commit` hook that publishes the delivery
  record automatically. It runs after the commit, hence after `commit-check` has had its say, so
  it can neither block a commit nor influence a gate. Never installed without the flag, never
  overwrites an existing `post-commit` hook.
- Page writes are batched: the feature page and the index land together or not at all. gatectl
  refuses a batch over the service's limit of 20 rather than letting it be rejected.

Confirmed live against a real MemoryKnowledge instance: two features exported and indexed, a
third feature's `rda critique` recalled exactly the one overlapping record (`session-auth` for a
token-refresh spec) and ignored the unrelated one; a commit fired the hook and published a
feature that had never been exported by hand; with the service stopped, the same commit
completed in 0.13s and reported success.

## 0.2.1 — 2026-08-19

Verified against a real MemoryKnowledge service (image built from the upstream repository,
branch `feat/server_team`), not stubs. The write path was correct; the read path was not, and
the whole 0.2.0 suite had been green over both.

- **Fixed: recall could never return anything.** `/wiki/search` answers with `results`; the page
  endpoints beside it answer with `items`, and the service's `openapi.yaml` documents no
  response schema for search at all. The adapter read `items`, so every search returned empty —
  including searches the server had matches for. Only running the service exposed this.
- **Added a status check behind an empty recall.** `/wiki/search` returns `code: 0` with zero
  results for any wiki whose status is not `ready`, and a wiki only reaches `ready` after an
  ingest run builds its index — so "no prior features match" and "this wiki was never indexed"
  are byte-identical on the wire. When a search comes back empty, `rda critique` now asks for
  the wiki's status and prints it rather than leaving the operator to guess. One extra request,
  and only on an empty result.
- Documented the constraint: `rda export` is useful the moment a wiki exists, but recall stays
  empty until that wiki has been ingested at least once, which needs LLM configuration on the
  memory service's side rather than on `rda`'s. Records written meanwhile are readable by `ref`
  and get indexed by the first ingest run that follows.

Confirmed live: `rda export` reaches exit `0` and the page reads back byte-for-byte through
`/wiki/page/read` with `locked: true` injected by the service; re-exporting a feature updates
its page in place (one wiki, one `ref`, no duplicates) and picks up critique findings written
between the two runs; a second feature lands beside it in the same wiki.

## 0.2.0 — 2026-08-19

- **Added `rda export`** — publishes a feature's delivery record (intent, invariants, acceptance
  criteria, derived tier, allowed paths, rollback, the latest ledger entry per gate, and each
  critique finding with its resolution state) to
  [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) as one wiki
  page. `--dry-run` prints the page and reaches no network. Exit codes are `0` and `2` only: a
  failed upload is not a gate verdict, so `export` can never emit `1`.
- **Added memory recall to `rda critique`** — prior delivery records are searched by the active
  spec's intent and appended to the critic's prompt, fenced as data and named untrusted, so a
  mistake already paid for once gets caught. A feature's own page is filtered out; fed back, it
  would read as corroboration.
- **No gate reads from memory, and this is enforced by a test.** `L`, `R`, `G-fast`, `G-full`
  and `C` do not know memory exists; `export` is a separate command and never a side effect of
  `commit-check`, so the trust anchor still performs no network I/O. Every read-side failure —
  unconfigured, unreachable, timed out, malformed — degrades to "no prior context".
  `test/memory-boundary.test.mjs` fails if anything under `src/core/` imports the adapter.
- A memory-backed gate was considered and rejected in writing: `/code-graph/impact` would
  strengthen `G-full`, but the gate would answer `NOT_EVALUATED` whenever a container was down,
  and would judge against an index that lags the working tree. Skill and Code-Graph assets are
  not exported — the first restates the README, the second is a once-per-repository `curl`.
- Credentials come from `TDAM_API_KEY` and `TDAM_SERVICE_ID` in the environment, never from
  `.rda/policy.yaml`, which is committed inside the target repository. A key written into policy
  anyway is ignored rather than honoured, and a test holds that line.
- **Fixed before shipping, found by running the CLI rather than by the suite:** a refused
  connection reported only `fetch failed`. Node collapses every transport failure into that
  string and hides the reason on `cause` — which, for localhost, is an `AggregateError` whose
  own message is empty. An operator could not tell a stopped container from a mistyped endpoint.
  The endpoint and the underlying cause now both reach the message.

## 0.1.1 — 2026-08-19

- **Fixed: tier B and tier A could never reach a green `commit-check`.** Gate C required every
  required gate's ledger entry to match the *current* working tree. But `L` and `R` are recorded
  before the implementation exists and `G-full` after it — by protocol design, different trees —
  so the condition was unsatisfiable for any tier whose `requires` spans both halves. Following
  the documented Quick start produced `L: PASS`, `R: PASS`, `G-full: PASS`, and then
  `gate C: FAIL — gate L is green for a stale tree`.
- Gate results now bind to the state the gate actually inspected, not uniformly to the tree:
  `L` to the spec digest alone, `R` to the spec digest plus the content of the spec's required
  test files, and `G-fast`/`G-full`/`X` to the whole working tree as before. `R` survives the
  implementation landing but stales when a required test is edited, weakened, or deleted after
  RED; a ledger entry carrying no binding is stale, never green.
- Added end-to-end coverage of the real protocol order (lock and red before the implementation,
  gate full after it, through to a green `commit-check`). The previous "full green cycle" test
  committed the implementation *before* gating, so all three gates saw one identical tree and the
  defect stayed invisible.
- **Fixed: the shipped policy template blocked a first real run.** It pinned
  `model: gpt-5.1-codex-mini`, which codex rejects on a ChatGPT account (HTTP 400, "not supported
  when using Codex with a ChatGPT account"), so `rda critique` could not run — and tiers A and B
  require a critique, so gate L stayed blocked. The pin is now commented out, and `runCritic`
  passes `-m` only when a model is actually pinned.
- **Fixed: the canonical first RED of TDD was not recognised as RED.** With the function under
  test not yet written, vitest reports `TypeError: <name> is not a function`, which matched
  neither the assertion nor the load class, so gate R answered `NOT_EVALUATED` and refused. It is
  now an assertion-class failure: the test loaded and ran and failed because the thing it names is
  missing. A genuinely broken test file still fails to load and is still caught by the load class.
- Verified against a real target repository with a real vitest toolchain, not stubs: `critique` →
  `lock` → `red` → implement → `gate full` → `commit-check` reaches exit `0` on tier B from the
  shipped template, with only the target's own `build`/`typecheck` commands filled in.

## 0.1.0 — 2026-08-18

`rda`, the executable core of protocol v1.1 — a gate engine, not the full control plane.

- Added the `rda` CLI: `init`, `new`, `status`, `critique`, `lock`, `red`, `gate fast`,
  `gate full`, `commit-check`, with exit codes `0`/`1`/`2` as the API.
- Added gates `L` (spec lock), `R` (RED confirmation), `G-fast`, `G-full`, and `C` (commit
  readiness), each a deterministic decision over policy and target-repo state — never an LLM
  opinion.
- Added tier derivation from a spec's allowed paths against `.rda/policy.yaml`.
- Added the append-only gate-results ledger (`docs/specs/<slug>/gates.json`) and spec locking
  (`spec.lock.json`) with digest-bound staleness.
- Bound gate C to the working tree, not only the spec digest, via a git-tree digest that excludes
  the ledger itself (the ledger's own growth must not stale the gates it records).
- Removed shell interpolation from policy command execution — a changed filename can no longer
  inject a second command.
- Hardened tier resolution, the critique-heading parser, the critic-policy fail-closed default,
  and diff-scope checks against the engine's own bookkeeping files.
- Added a global top-level exit-2 boundary: any uncaught engine error is `NOT_EVALUATED`, never
  a stack trace.
- **Deferred to a later release:** gate `X` (cross-model review). Tier A's shipped policy
  template lists `X` in its `requires`, but no gate implements it yet — tier A cannot reach a
  green `commit-check` in v0.1, by design, fail-closed.

## 1.1 — 2026-08-18

- Added the Completion & Evidence Protocol.
- Removed implementer authority to self-assign `VERIFIED` or `DONE`.
- Added `READY_FOR_VERIFICATION`, `VERIFYING`, `REWORK_REQUIRED`, `VERIFIED`, and `STALE` semantics.
- Added independent and adversarial completion verification.
- Added deterministic Completion Authority and fail-closed policy predicates.
- Added requirement traceability, completion candidate, verification report, evidence, and decision schemas.
- Added evidence freshness and digest-bound invalidation.
- Added bounded repair loops and `NEEDS_HUMAN` escalation.
- Added gap taxonomy: `SPEC_GAP`, `IMPLEMENTATION_GAP`, `VERIFICATION_GAP`, and `NEW_SCOPE`.
- Expanded the AUTH-042 example through terminal completion.
- Converted the test-plan template from Markdown-like content to valid YAML.
