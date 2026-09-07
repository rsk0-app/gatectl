# gatectl — a gate engine for work that must be earned

An AI agent tells you the work is done. How do you know?

Today the answer is usually: you read the diff, you run the tests it wrote, and you take its word
for the rest. `gatectl` replaces the taking-its-word part. It is a small CLI that installs into a
repository and decides, by policy, whether a piece of work may be locked, implemented, or
committed — and every decision it makes is a plain exit code derived from evidence, never a model's
opinion about its own output.

A model may write the specification, the critique, and the code. Only `gatectl` decides whether any
of it is green.

```
gatectl lock       # the spec is frozen and digested; nothing may drift from it silently
gatectl red        # every acceptance criterion must FAIL first, replayed from the base commit
gatectl green      # each criterion, by name, now passes
gatectl gate full  # typecheck, build, suite, allowed paths, tier ceremony
gatectl gate x     # a SECOND model reviews the diff; its citations are checked against real lines
gatectl complete   # the record is signed and the commit may happen
```

What makes this different from a CI pipeline is the ORDER and the REFUSAL. A criterion that was
never red proves nothing about the code that made it green, so `gatectl` replays it at the base
commit and refuses the slice if it passed there. A reviewer that says "looks good" without pointing
at a line is not a review, so its citations are verified against the file. A gate that cannot run
answers `2`, and nothing downstream may read that as approval.

Exit codes are the API:

| Code | Meaning |
| --- | --- |
| `0` | green — the gate PASSed |
| `1` | not green — the gate FAILed, reasons are printed |
| `2` | `NOT_EVALUATED` — the gate could not run at all (misconfiguration, missing policy, missing command, corrupt state) |

`2` is never a synonym for "probably fine." It means the gate refused to answer.

What is deterministic is the **aggregation**: given the same exit codes, digests and diff, `gatectl`
returns the same verdict, and no model can argue with it. The commands underneath — your build, your
suite — are as reproducible as your toolchain makes them. See [Limits in v0.1](#limits-in-v01) for
what this does *not* yet guarantee, written before you find out for yourself.

## What it needs

Node 20+ and git. That is the whole runtime: one dependency (`js-yaml`), no daemon, no service, no
account.

Two steps call a model — `critique`, which tries to refute a specification before it is locked, and
`review`, which reads the implementation diff for gate X. Both shell out to a CLI you already have
and pay for (`codex`, `claude`, or anything that takes a prompt and prints text), so `gatectl` never
holds an API key. Which tiers require them is your policy's decision: a repository can run the whole
lock → red → green → full chain with no model in the loop at all.

## What it is not

- Not a code generator. It never writes your implementation, and it never fixes a failing gate.
- Not a linter or a test runner. It runs the commands your policy declares and reads their exit
  codes; what those commands do is yours.
- Not a sandbox. A test command that lies about its results can lie to `gatectl` too — see the
  limits section, which says so first rather than last.
- Not a replacement for review by a person. It is what stops "done" from being asserted rather than
  shown, so that a person's attention goes to the parts that need judgement.

## Install

`gatectl` is guest software: it reads and writes files inside a target repository but ships from
here.

```sh
git clone https://github.com/rsk0-app/gatectl && cd gatectl && npm link
cd /path/to/your-repo
gatectl init                  # writes .gatectl/policy.yaml and .gatectl/MVP.yaml
gatectl new my-first-slice    # scaffolds docs/specs/my-first-slice/
gatectl next                  # tells you the one step that unblocks the next one
```

It can also be run from a clone without installing, against any repository:

```sh
node bin/gatectl.mjs <command> --target /path/to/your-repo
```

Nothing it writes lives in your repository except the policy, the specs and the git hooks you ask
for: the ledger — every gate result, attestation and completion — sits under `~/.gatectl/state/`,
keyed per repository, so a gate cannot be made to pass by editing the tree it is judging.

`gatectl init` scaffolds `.gatectl/policy.yaml` and `.gatectl/MVP.yaml` into the target and never
overwrites files that already exist there.

It fills the policy in from the target's own manifests rather than shipping placeholders: the
package manager comes from the lockfile, the test runner and its per-file syntax from the
declared dependencies, `typecheck` from TypeScript's presence. Cargo, Go and pyproject targets
are read too. Detection is offline and evidence-based, and it prints what each conclusion rests
on:

```
detected: package manager: pnpm
detected: test runner: jest
  build         → pnpm run build
  typecheck     → npx tsc --noEmit
  test_file     → npx jest {file}
```

**What it cannot conclude, it leaves commented out** — `cargo` has no per-file test invocation,
so a Rust target gets no `test_file`, and gate R answers `NOT_EVALUATED` until a human supplies
one. A wrong command that exits `0` is worse than no command at all.

**Tier paths are reported, never edited.** `init` says which shipped patterns match files here
and which match nothing yet, and leaves every one of them in place:

```
tiers: src/lib/auth/** matches 1 file(s) → tier A. Confirm that is right.
tiers: 5 shipped pattern(s) match nothing here yet (...) — left in place
```

Pruning a dead pattern would be a tier downgrade deferred into the future: add `supabase/` next
month and its migrations land in a lower tier, with nothing announcing it. Deciding what counts
as security-sensitive stays a human signature — `gatectl` derives tiers, it does not invent them.

## Fast delivery (0.16)

New repositories default to a local fast workflow, with no mandatory RED replay or CI:

```sh
gatectl init --client codex --mode fast  # or --client claude
# During implementation:
gatectl check-related
# Once a complete stage is ready:
gatectl check
gatectl review
gatectl review-check
gatectl ready-to-commit
gatectl finish
```

`check-related` runs only the configured related tests. `check` performs the final declared tests,
typecheck and build. In strict mode it also proves criterion GREEN. Identical expanded commands
share signed local receipts: test-green and check-all do not execute the same command twice over
the same inputs. A whole-suite command never implicitly proves a different per-case command.
`next`, `ready-to-commit` and `finish` only read evidence; none invokes tests or a model.

Fast review runs once per candidate. After edits, it supplies the difference from the previous
reviewed tree and the previous report, and requires an updated report covering every criterion,
including explanations for resolved severe findings. `review --full` requests the complete diff;
spec or reviewer-configuration changes automatically require a full review. These are model
judgments; structured coverage does not prove the reasoning correct.

Receipt reuse checks the candidate tree, expanded command, policy, runtime, environment, executable
metadata, dependency metadata (`node_modules`, `.venv`) and common ignored `.env` files. Set
`workflow.dependency_paths` and `workflow.input_paths` for other local inputs. These are filesystem
metadata checks, not a sandbox or proof of reproducible execution. For remote services, time-sensitive
tests or other external inputs use `check --fresh`, or set `workflow.cache: false`. Failed forced
reruns invalidate earlier success. No network service or CI installation is needed for fast mode.

Existing policies are **not** silently relaxed. To opt in explicitly, run `gatectl workflow fast`,
review the policy diff and commit setup separately. Fast mode requires final checks and independent
review for every tier. `gatectl workflow strict` restores saved tier requirements; a new strict
repository uses `init --mode strict`. RED and independent reruns belong to this explicitly chosen
workflow, not the normal edit loop. A policy-only spec must gain real test obligations when moving
to strict requirements.

| Purpose | Readable command | Legacy alias |
| --- | --- | --- |
| Check spec | `spec-check` | `lock` / L |
| Prove RED | `test-red` | `red` / R |
| Prove GREEN | `test-green` | `green` |
| Related tests while editing | `check-related` | — |
| Final policy checks | `check` | — |
| Full checks | `check-all` | `gate full` / Gfull |
| Validate review | `review-check` | `gate x` / X |
| Commit readiness | `ready-to-commit` | `commit-check` / C |
| Finish task | `finish` | `complete` |

Legacy commands and ledger/policy identifiers remain supported. `next --legacy-names --json`
retains old command names for existing integrations (new workflow policies still suggest `check`).

## Codex and Claude Code plugins (0.15)

The same `plugins/gatectl` package supports both hosts. It includes the CLI and its runtime
dependencies in a generated bundle, so installation needs Node 20+ and git, but no global
`gatectl`, npm install, API key or daemon. Each host continues using its own configured model.

Install from the public marketplace:

```sh
# Codex CLI (current CLI calls this command `add`)
codex plugin marketplace add rsk0-app/gatectl
codex plugin add gatectl@gatectl

# Claude Code
claude plugin marketplace add rsk0-app/gatectl
claude plugin install gatectl@gatectl
```

Start a new session after installation and review/trust the plugin hooks when the host requests
it. In the target repository, ask “set up gatectl for this repository.” The delivery skill runs
`init --client codex` or `init --client claude`; for a new policy, this chooses the other CLI as the
critic/reviewer. That other CLI must be installed and authenticated when the policy requires it.
Existing policies are never silently rewritten. Review their author/reviewer configuration when
switching clients, and commit initial policy setup separately from feature work.

After setup, ordinary implementation requests such as “сделай задачу: добавь экспорт CSV” are
routed by the plugin context into the delivery skill. SessionStart/UserPromptSubmit hooks supply
context only in repositories containing `.gatectl/policy.yaml`. The skill enrolls implementation
work with `task start`; read-only questions do not enroll. A Stop hook checks `next --json` for
that session's task and requests at most one continuation if it is incomplete. It never runs tests,
calls another model, changes policy, installs packages or grants an exception. Cancellation pauses
reminders without creating PASS. Host hooks and local processes are not an adversarial sandbox;
CI and repository protection remain the enforcement boundary.

Explicit invocation is also available: `/gatectl:delivery` in Claude Code, or select the gatectl
`delivery` skill in Codex. The bundled CLI is `plugins/gatectl/bin/gatectl.mjs` in a checkout and
`<installed-plugin-root>/bin/gatectl.mjs` after installation. Hooks supply the installed path.

```sh
node plugins/gatectl/bin/gatectl.mjs version
node plugins/gatectl/bin/gatectl.mjs task start csv-export --session SESSION_ID --client codex --target /path/to/repo
node plugins/gatectl/bin/gatectl.mjs next --json --target /path/to/repo
```

For a local checkout, replace the marketplace repository in the installation commands with the
absolute checkout path. Claude Code can also load it for a session with
`claude --plugin-dir /absolute/path/to/gatectl/plugins/gatectl`. Codex installation alone does not
trust the hooks: review the host's hook-trust prompt before relying on automatic reminders.

The package formats and shared hook protocol follow the
[Codex hooks reference](https://learn.chatgpt.com/docs/hooks) and
[Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference).

### Policy-only work

`next` and `complete` follow the gates the effective tier actually requires. A docs-only tier C
with `requires: [Gfast]` does not require critique, lock or fabricated RED/GREEN tests. Its YAML
spec can explicitly declare `verification: policy` and give acceptance criteria without `test`.
If its actual scope escalates to a tier requiring R, the missing tests block delivery.

Completion records say `basis: policy_gates` and list the per-criterion predicates not claimed.
Tiers requiring R retain replayed RED and final-tree GREEN for every criterion and report
`basis: criterion_red_green`. ACCEPT means the configured evidence obligations passed; it is not
proof that the specification was sufficient or every test asserted the right behavior.

### Updating from 0.14

- Declare `commands.typecheck` for Gfull and verifier command reruns. Use `none` only when the
  project genuinely has no typecheck. An absent command now refuses evaluation.
- Old review acceptances have no current-review binding and no longer clear findings. Re-review
  and obtain an explicit acceptance for the exact review, spec and tree if the exception still applies.
- A modified active `spec.lock.json` is allowed locally only when its exact bytes match the signed
  gate-L record. Existing locks need a fresh `lock` record before a changed lock is shipped.
  Other files in that directory do not acquire a blanket exemption from meta-class or scope checks.
- `verify --rerun` reports the command checks it actually reran (`Typecheck`, `Build`, `TestSuite`),
  and keeps full gate names in `not_rerun`. It does not claim that running build/tests re-evaluates
  Gfull scope checks, Gfast test selection, replayed RED or model review. Skipped commands are not
  recorded as executed checks. Consumers expecting an issued `Gfull: PASS` must adopt these labels.
- Reinstall/update the plugin in each host and start a new session. The CLI and both plugin
  manifests carry the same version. `npm run check:plugin` refuses a stale generated runtime.

## Commands

| Command | What it does | Exit codes |
| --- | --- | --- |
| `gatectl version` | Print the engine version | `0` |
| `gatectl task start/pause` | Enroll or pause a plugin session without changing gate evidence | `0`, `2` |
| `gatectl init [--client codex\|claude]` | Scaffold `.gatectl/policy.yaml` and `.gatectl/MVP.yaml` (idempotent) | `0` |
| `gatectl new <slug>` | Scaffold `docs/specs/<slug>/spec.yaml` + `spec.md` and set it ACTIVE | `0`, `2` (usage) |
| `gatectl next [--json]` | What to do now, and why — the state is derived, never stored | `0`, `2` |
| `gatectl spec compile` | Validate the spec and print the test obligations the gates will hold it to | `0`, `2` |
| `gatectl status` | Show the active feature's tier, lock state, and blocking questions | `0`, `2` (no policy) |
| `gatectl critique` | Run the configured critic CLI over the active spec, write `critique.md` | `0`, `2` (critic failed to run) |
| `gatectl lock` | Gate L: validate the spec is complete and (per tier) critiqued; append a lock version | `0`/`1`/`2` |
| `gatectl red [--base <sha>]` | Gate R: replay `base + the test changes` and require every criterion RED for its own declared reason | `0`/`1`/`2` |
| `gatectl green` | The other half: every criterion's test, on the tree in front of us, required to pass | `0`/`1`/`2` |
| `gatectl gate fast` | Gate G-fast: typecheck + related tests against the current diff | `0`/`1`/`2` |
| `gatectl gate full` | Gate G-full: typecheck + build + full suite + diff-scope checks (allowed paths, meta-class, no `.only`/`.skip`, no deleted tests) | `0`/`1`/`2` |
| `gatectl review` | Run the policy's **reviewer** model over the current diff, write the review | `0`, `2` (reviewer failed to run) |
| `gatectl gate x` | Gate X: the review exists, covers this diff, and has no unresolved critical/high finding | `0`/`1`/`2` |
| `gatectl commit-check` | Gate C: every gate this feature's **effective** tier `requires` is green, for the **current** spec digest *and* the current state each of those gates inspected, and the working tree has not drifted from the index | `0`/`1`/`2` |
| `gatectl verify` | Check a claim against the commit it is about; `--rerun` re-runs that commit's gates; `--issue` signs the result | `0`/`1`/`2` |
| `gatectl attest` | Check an evidence envelope against this commit and sign it — the signer, which runs no repository code | `0`/`1`/`2` |
| `gatectl keygen` | Create the issuer keypair: private key for CI's secret, public key for the repository | `0`, `2` |
| `gatectl complete` | The Completion Authority: have the policy evidence obligations been met? | `0` ACCEPT / `1` REJECT / `2` |
| `gatectl export` | Publish this feature's delivery record to team memory (`--dry-run` prints it instead) | `0`, `2` |

Every gate result is appended to a signed ledger that lives **outside the target repository**
(see [Where the evidence lives](#where-the-evidence-lives)). Gate C
reads the *latest* entry per required gate and checks it against the spec's current content
digest **and against the state that gate actually inspected**; a gate green for an older digest,
or for state that has since moved, is stale, not green.

What "the state that gate inspected" means differs per gate, because the gates run at different
points in the protocol — `L` and `R` before the implementation exists, `G-fast`/`G-full` after it:

| Gate | Bound to | Stales when |
| --- | --- | --- |
| `L` | the spec digest alone — it read the spec and nothing else | the spec is edited |
| `R` | the spec digest + the content of the spec's **required test files** | a required test is edited, weakened, or deleted after RED |
| `Gfast`, `Gfull`, `X` | the spec digest + the tree the commit would carry (see below) | any file in that tree changes |

`R` deliberately survives the implementation landing — that is the entire point of the
RED → implement → GREEN loop — but not the required tests being changed underneath it. A ledger
entry that predates its binding, or carries none, is stale, never green.

### The tree a gate binds to is the tree the commit will carry

`git commit` writes the **index**, not the working tree. A gate result bound to the working tree
while the commit is built from the index is a time-of-check/time-of-use hole: `commit-check`
verifies one set of bytes and `git commit` records another. So the binding follows what git will
actually do:

| State | Bound to | Why |
| --- | --- | --- |
| something staged | the real tree OID of the **index** | that OID *is* the tree the next commit gets — verifiable later against a commit SHA, using nothing but `git` |
| nothing staged | the whole working tree (tracked + untracked) | there is no commit shape yet; this is what the gate's commands just ran against |

The gates run their commands (build, full suite, typecheck) against the *working tree*. Once
something is staged, a green is only honest if the two agree — so `commit-check` FAILs when the
working tree has drifted from the index, naming the files:

```
gate C: FAIL
  - working tree has drifted from the index — the gates ran against content this commit will
    not carry: src/impl.ts
```

An untracked file counts as drift too: it was on disk while the suite ran, and will be absent
from the commit. `gatectl` reports drift and never repairs it — staging on the agent's behalf would
be the gate editing the commit it is supposed to be judging.

Nothing is carved out of that hash. Until 0.7 the ledger had to be, because it lived in the
repository and was appended to by the very gates that hashed it; moving it out removed the
exception along with the problem. The bound OID is the commit's tree, exactly.

## Commands, and the difference between unknown and absent

`.gatectl/policy.yaml` gives each gate the commands it runs. A command may be a shell template or
the literal `none`:

```yaml
commands:
  typecheck: none            # this project has no type checking — the gate skips the step
  build: none                # nothing to build
  test_all: "npm test"
  test_file: "npx vitest run {file}"
```

| Value | Meaning | Gate behaviour |
| --- | --- | --- |
| missing / commented out | unknown — nobody has said | `NOT_EVALUATED` (exit `2`) |
| `none` | the owner declares no such step exists | skipped, and the skip is printed |
| a command | run it | pass/fail on its exit code |

The two empties are not interchangeable. Treating them as one made every plain-JavaScript
repository with no bundler and no TypeScript unable to reach a green gate at all. `none` is a
declaration you are making, in a meta-class file agents never edit — and a green that skipped a
step says so:

```
gate Gfull: PASS
  ~ skipped build (declared none in policy)
```

`test_file` is never `none`: gate `R` drives every required test through it, and skipping there
would mean never confirming RED.

`gatectl init` writes `none` only where absence is proven — a `package.json` that exists and names
no build script is evidence, not ignorance. With no manifest at all it writes nothing, and the
gate refuses until a human fills it in.

## Tier ceremony

A feature's tier is derived from paths, never chosen by hand, against `.gatectl/policy.yaml`'s
`tiers` map (A is highest ceremony):

| Tier | Typically | `requires` (v0.1) |
| --- | --- | --- |
| **A** | auth, migrations, payments, API routes — anything security- or data-shape sensitive | `L, R, Gfull, X` |
| **B** | ordinary application code | `L, R, Gfull` |
| **C** | docs, styling, static content | `Gfast` |

Gate `C` is not listed in `requires`: `commit-check` **is** gate C, so requiring a green C before
producing one can never be satisfied. A policy that still lists it (older templates did) works —
the entry is ignored, not honoured.

### Declared tier, effective tier

`Allowed Paths` declare what a feature *intends* to touch. The diff is what it *did*. Taking the
tier from the declaration alone leaves a hole: `src/**` resolves to tier B while covering
`src/lib/auth/**`, which is tier A — so a feature could be critiqued, locked and committed at B
ceremony while shipping A-tier code.

The effective tier is therefore the **higher of declared and actual**, recomputed from the real
diff every time it matters. It only ever escalates: a narrow diff never buys a cheaper tier than
the spec asked for. An escalation invalidates the lock, because the spec was reviewed under
lighter ceremony than the code turned out to need:

```
gate C: FAIL
  - tier escalated B → A by the actual diff — the lock was taken at B; re-lock at A
  - gate X never ran for this feature
```

`gatectl status` says the same thing before you get there: `tier: A (declared B, escalated by the
actual diff)`. The engine's own bookkeeping — this feature's spec dir, `docs/specs/ACTIVE`, and
`meta_class` paths — is excluded from that computation: those files move during every normal
cycle, and touching a meta-class file is already a named `G-full` failure, not a tier signal.

Tier A additionally requires gate `X` — a second model reviewing the implementation. Until 0.8
that gate did not exist and tier A could not reach a green `commit-check` at all; it does now.
See [Gate X](#gate-x--the-second-model).

## Quick start

```sh
gatectl init                      # scaffold .gatectl/policy.yaml, .gatectl/MVP.yaml
gatectl new my-feature            # scaffold docs/specs/my-feature/spec.md, set ACTIVE
# edit spec.md: intent, invariants, acceptance criteria (each naming a required test),
# allowed paths, rollback
gatectl next                      # at any point: what to do now, and why
gatectl critique                  # or write docs/specs/my-feature/critique.md by hand
# resolve every critical/high finding with a RESOLVED: line
gatectl lock                      # gate L — locks the compiled spec digest
gatectl red --base <sha>          # gate R — replays base + the test changes: every criterion RED
# implement, following the locked spec
gatectl green                     # every criterion's test now passes on this tree
gatectl gate fast                 # quick loop: typecheck + related tests
gatectl review                    # tier A: a second model reviews the diff (writes outside the repo)
# resolve every critical/high finding with a RESOLVED: line
gatectl gate x                    # gate X — cross-model review is green for THIS diff
gatectl gate full                 # build + full suite + diff-scope checks
git add -A                    # stage everything: the commit is the index, and that is what C binds to
gatectl commit-check              # gate C — is this feature actually ready to commit? Writes the attestation
git commit                    # only if commit-check exited 0 (a pre-commit hook can enforce this)
gatectl verify --commit HEAD      # the independent check — this is the one CI runs
gatectl complete                  # is the feature actually delivered, not just safely committed?
```

`commit-check` exiting `0` is the only signal that means "commit this." Everything upstream of
it is advisory to a human or an agent. Stage before you run it: with a staged index, `C` binds
to the exact tree OID your commit will carry.

## Team memory (optional)

`gatectl` decides; it does not remember. Every gated feature leaves behind hard-won text — a locked
spec, an adversarial critique with its resolutions, a derived tier, a ledger of real gate
outcomes — and by default all of it stays in one repository's `docs/specs/`. The next feature,
and the next agent, start cold.

`gatectl export` publishes that record to
[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) as one wiki
page per feature, and `gatectl critique` recalls prior records into the critic's prompt so a
mistake this team already paid for gets caught the second time.

```yaml
# .gatectl/policy.yaml
memory:
  endpoint: "http://localhost:8421/v3"
  team_id: "team-xxxx"
  wiki_name: "delivery-record"   # defaults to the repository's directory name
```

Credentials are read from the environment only — `TDAM_API_KEY` and `TDAM_SERVICE_ID` — never
from `.gatectl/policy.yaml`, which is committed. A key written into policy is ignored, not honoured.

```sh
gatectl export --dry-run    # print the page, reach no network
gatectl export              # publish it
```

Pages are written through `/wiki/page/write`, which stamps them `locked:true`: the service's
LLM ingest pipeline never rewrites what `gatectl` sent. The page `ref` is `gatectl/<slug>.md`, stable
per feature, so re-exporting updates the record instead of accumulating copies.

### Recall reads gatectl's own index, not the service's search

Writing works against a wiki the moment it exists. **The service's search does not.** Both
`/wiki/search` and `/wiki/page/ls` answer `code: 0` with zero results for any wiki whose status
is not `ready`, and a wiki reaches `ready` only after an LLM ingest run builds its index — so on
a wiki `gatectl` has merely written to, neither can find anything, and success is indistinguishable
from never-indexed.

`/wiki/page/read` carries no such gate: it reads from disk by ref. So `gatectl` keeps its own index
page, `gatectl/_index.md`, one line per exported feature, written in the same atomic batch as the
feature's page:

```
- rate-limit | B | Add per-tenant rate limiting to the public API.
- session-auth | B | Add session authentication with rotating tokens.
```

Recall reads that page, ranks entries locally by word overlap with the active spec's intent, and
reads the winners by ref. Nothing in the path waits on an LLM, and the matching is a
deterministic function of text `gatectl` wrote — the same property the gates are built on. The
ranking is deliberately crude (lowercase overlap, terms under four characters dropped): it only
has to hand a critic a few plausibly related records, and being dumb keeps it identical on every
machine.

### Registering the repository with CodeGraph — once, by hand

`gatectl` writes the delivery record. **Code structure — symbols, callers, impact analysis — comes
from CodeGraph, which agents consume directly through the memory service's own tooling.** `gatectl`
is not a party to it and contains no code for it: `test/readme-codegraph.test.mjs` fails if any
file under `src/` so much as mentions CodeGraph.

Registration is one call, made once per repository by a human:

```sh
curl -X POST "$TDAM_ENDPOINT/code-graph/create" \
  -H "Authorization: Bearer $TDAM_API_KEY" \
  -H "x-tdai-service-id: $TDAM_SERVICE_ID" \
  -H "Content-Type: application/json" \
  -d '{"team_id": "team-xxxx", "repo_url": "https://github.com/you/your-repo.git", "branch": "main"}'
```

`team_id` and `repo_url` are required; `branch` defaults to `main`. Credentials come from the
environment, never from `.gatectl/policy.yaml` — that file is committed.

The call is **idempotent** on `(service_id, team_id, repo_url, branch)`: a repeat returns the
existing registration with HTTP 200 rather than creating a second one, so losing the response
and retrying is safe. It returns immediately with `status: pending` — cloning and indexing run
in the background, and progress is read from `/code-graph/status`.

Skipping this step costs you nothing in `gatectl`; it only means agents work without a code index.

### Exporting automatically

```sh
gatectl init --with-hooks     # installs .git/hooks/post-commit
```

The hook publishes after the commit, which is after `commit-check` has had its say — so it can
neither block a commit nor influence a gate. It ends in `|| true`, and an unreachable memory
host costs a commit nothing measurable.

`init` never installs it without the flag, and never overwrites a `post-commit` hook the target
already has: everything else `init` writes lives under `.gatectl/` and `docs/specs/`, while a git
hook is the target's own territory.

**No gate reads from memory.** `L`, `R`, `G-fast`, `G-full` and `C` do not know it exists.
`export` is its own command and never a side effect of `commit-check` — the trust anchor
performs no network I/O, and a failed upload is not a gate verdict, which is why `export`
returns `0` or `2` and never `1`. On the read side, every failure — unconfigured, unreachable,
timed out, malformed — degrades to "no prior context" and `critique` runs exactly as it does
today. `test/memory-boundary.test.mjs` fails if anything under `src/core/` ever imports the
memory adapter, so the boundary is checked by a machine rather than by discipline.

A memory-backed gate was considered and rejected: `/code-graph/impact` could genuinely
strengthen `G-full`, but the gate would then answer `NOT_EVALUATED` whenever a container was
down, and would judge against an index that lags the working tree. Skill and Code-Graph assets
are not exported either — the first restates this README, the second is a once-per-repository
`curl`.

## Where the evidence lives

Until 0.7 the gate ledger was a JSON file in the target repository — append-only by discipline,
in a directory the agent being gated could write. A forged green was indistinguishable from an
earned one. It now lives outside the repository entirely:

```
~/.gatectl/state/<repo>-<id>/features/<slug>/gates.jsonl        # the ledger
~/.gatectl/state/<repo>-<id>/features/<slug>/attestation.json   # the last green commit-check
~/.gatectl/state/keys/<repo>-<id>.key                           # the signing key, mode 0600
```

`GATECTL_STATE_DIR` moves the whole tree; `GATECTL_ATTEST_KEY` replaces the key file, which is how CI
verifies without a shared filesystem. `gatectl init` prints both paths — a trust boundary nobody can
see is one nobody can check.

Each ledger entry carries an HMAC over its own body **and over the previous entry's MAC**, so
editing, deleting or reordering a line invalidates every line after it. A ledger that does not
verify is not read at all: gate C answers `NOT_EVALUATED`, never `FAIL` and never `PASS`, because
nothing can be concluded from a record that was edited.

The honest limit: on one machine, under one user, the key is readable by whatever the agent can
run. This is a real boundary against tampering inside the repository, an accidental rewrite, a
forged ledger arriving in a pull request, and replay of an old green onto a new tree. It is not a
boundary against an agent that goes looking for the key file. That needs the runner to be a
separate principal — which is what `gatectl verify` is shaped for.

## Attestation and independent verification

A green `commit-check` writes a signed attestation: the tier and its requirements, the spec and
policy digests, the tree OID, the ledger head, and which gates went green over exactly that
state. Every field is recomputable from the repository at a commit.

```sh
gatectl commit-check
#   gate C: PASS
#   attested tree 1950a6b9e956… → ~/.gatectl/state/repo-d787be2a8840/features/f1/attestation.json
git commit -m "…"
gatectl verify --commit HEAD
#   verify e2a06388a314: PASS
#     feature f1, tier B, gates L, R, Gfull green over this exact tree
```

`verify` trusts nothing gatectl wrote except the signature. It reads the spec and the policy **at
that commit**, re-derives the tier from the paths that commit actually changed, re-derives the
required gates from that policy, and refuses an attestation that does not match:

- a green earned on a different tree — `attested tree … is not this commit's tree …`
- a spec or policy that has moved since — the digests do not match
- a policy that has since required more gates — `gate X is required by this commit's policy but
  not attested green`
- an edited attestation, or one signed with another key — the signature check runs first

`--rerun` is the difference between "the signature matches" and "the gates still say yes". It
checks out that commit into a detached worktree, reads the policy that commit carries, and runs
its `install` (if declared), `build` and `test_all` there — so nothing about the current
checkout, the working tree, or gatectl's own state can influence the answer. A commit whose suite
does not actually pass fails here even though its attestation verifies perfectly, which is
exactly the case a signature check alone cannot catch.

Every attestation also records the environment that produced it — node version, platform, arch,
and the policy commands as written, digested. `verify` reports a difference rather than failing
on it: verifying somewhere else is the point, so a different environment is expected. What it
buys is that two machines disagreeing about one commit leave a record of how they differed.

`gatectl init --with-hooks` also installs a **pre-commit** hook that refuses a commit gate C has not
passed (and stands aside when no feature is ACTIVE — it gates features, not the repository), plus
the advisory `post-commit` hook that publishes the delivery record. A hook is bypassable with
`--no-verify`; `gatectl verify` in CI is not.

## Three principals, and what each is allowed to be

The engine assumes the agent is a hostile executor with full control of the repository, the
local machine and the contents of the pull request. That assumption only pays off if the pieces
that decide are not reachable from the pieces it controls:

| | runs repository code | holds the key | what its word is worth |
| --- | --- | --- | --- |
| **local CLI** | yes | the HMAC ledger key | a **claim**, addressed to its own author |
| **runner** (CI job `run`) | yes | nothing | recorded results — only as trustworthy as its isolation |
| **signer** (CI job `attest`) | **no** | the Ed25519 private key | a **verdict**, checked against sources the branch cannot write |

The runner is handed no secrets at all, because `npm install` alone executes lifecycle scripts
from the branch under test: a signing key in that environment is a key that branch can print.
gatectl enforces the same rule one level down — every command it runs, anywhere, gets an environment
with `GATECTL_SIGNING_KEY`, `GATECTL_ATTEST_KEY` and `GITHUB_TOKEN` removed, unless policy names them.

### The signer does not believe the evidence

Splitting the jobs buys nothing on its own. If the signer signs whatever lands in front of it,
the attack simply moves: nobody steals the key, they hand over a forged PASS and have it blessed.
So the evidence envelope is a set of **claims**, and each field is one of two kinds:

- **cross-checked** — repository, workflow run id and attempt, head and base commit, tree OID,
  policy digests. The signer compares every one against its own GitHub context and against git.
- **recorded** — command results, timings, environment. The signer cannot re-derive these without
  running the code, which is exactly what it must not do. They are attested as *"the runner said
  this"*, never as *"this is true"*.

An unknown field is refused rather than ignored: a field the signer cannot check must not ride
along inside a signature. And the signature says what it covers — nothing about whether the
commands inside told the truth. Bounding *that* is the sandbox's job, not cryptography's.

### Authority comes from the base commit

`verify --base <sha>` reads `.gatectl/policy.yaml` from the commit the pull request branched from,
not from the branch being judged. A candidate that supplies its own policy chooses its own tier,
its own required gates, and — worse — the commands that stand for "the tests". The base commit is
immutable; a branch name would be a race between the run and the signature.

```
verify: NOT_EVALUATED
  - candidate modifies its own authority — .gatectl/policy.yaml differs from the base commit's
  - land a policy change in its own pull request, reviewed as the meta-class change it is
```

## Claims, verdicts, and who is allowed to be believed

The local record and a CI verdict are not the same kind of thing, and gatectl stopped pretending
they were:

|  | local `commit-check` | CI `verify --rerun --issue` |
| --- | --- | --- |
| what it is | a **claim**, addressed to its own author | a **verdict**, addressed to everyone else |
| signature | HMAC — one secret signs *and* checks | Ed25519 — private signs, public checks |
| who can forge it | anyone who can read the key, i.e. the agent | only the holder of the private key |
| what it covers | every gate the tier requires | exactly what the issuer re-ran, and it says what it did not |

The distinction matters because a symmetric signature makes every verifier a potential forger:
to check an HMAC you need the key that produces it, so handing CI the ability to verify would
hand it the ability to fabricate. Ed25519 splits the two. The public half can be committed,
published, pasted anywhere; only the private half signs.

```sh
gatectl keygen                                   # private key + .gatectl/attest.pub (commit the public one)
gh secret set GATECTL_SIGNING_KEY < <private>    # the issuer's key lives in CI, nowhere else
rm <private>                                 # a developer machine has no reason to hold it
```

`gatectl init --with-ci` writes `.github/workflows/gatectl-verify.yml`, which runs:

```sh
gatectl verify --commit $SHA --rerun --issue --out gatectl-issued.json
```

It needs **no local state at all** — no ledger, no attestation, no key beyond `GATECTL_SIGNING_KEY`.
It re-runs the commit and signs what it found:

```json
{ "issuer": "github-actions:gatectl verify", "commit": "e2a0638…", "tree": "1950a6b…",
  "reran": ["typecheck", "build", "full suite"], "not_rerun": ["L", "R", "Gfull"], "claim_checked": false,
  "alg": "ed25519", "sig": "…" }
```

`not_rerun` is the part that keeps this honest. A CI runner has no model to redo gate X with and
no ledger to redo gate L or R from. Command reruns also do not repeat Gfull scope checks or
Gfast test selection, so those gates remain in `not_rerun` too. A
verdict that overstated its own reach would be the exact failure this engine exists to prevent,
one level up.

Anyone can then check that verdict holding no secret:

```sh
gatectl verify --commit $SHA --attestation gatectl-issued.json --pubkey .gatectl/attest.pub
```

Two things on the GitHub side finish the job, and without them the rest is decoration: make the
check **required** in branch protection, and keep `.github/workflows/**` in `meta_class` (gatectl
does) so an agent editing the workflow fails gate G-full instead of quietly disarming its own
referee.

## How a failure is classified

A non-zero exit is only RED if `failure_classes` say it looks like the failure the criterion
declared. The class that matters most is `empty`, and it exists because runners lie by omission:
`vitest run file -t "no such case"` **exits 0** having run nothing, which reads as "this test
already passes" unless the emptiness is recognised for what it is.

| Runner said | gatectl concludes |
| --- | --- |
| the failure kind the criterion declared | RED — the point of gate R |
| some other failure (`load`, `unknown`) | `NOT_EVALUATED` — the harness broke, nothing was proven |
| an `empty` run, whatever the exit code | `NOT_EVALUATED` — a case that never ran is not RED, and not GREEN either |
| exit 0, not empty | RED fails (nothing to implement); GREEN passes |

Gate R drives each criterion through `test_case` when it names a selector, and `test_file` when
it names only a file. Without a `test_case` command a criterion naming a case is `NOT_EVALUATED`:
running the whole file would answer a different question and record it under this criterion's
name.

## The spec is machine-readable

Markdown is for the person: the why-now, the alternatives, the things that only read well in
sentences. But a gate that finds its obligations by regex over free text accepts a typo silently —
a criterion whose `required:` line was mangled simply stops being required, and nothing says so.
So `docs/specs/<slug>/spec.yaml` is the source of truth:

```yaml
id: session-auth
state: DRAFT
mvp_ref: auth-works
intent: |
  Expired refresh tokens must stop working.
invariants:
  - id: INV-01
    statement: Existing sessions remain valid
acceptance_criteria:
  - id: AC-01
    statement: An expired refresh token is rejected
    test:
      file: test/auth.test.ts
      selector: rejects an expired refresh token
      expected_red: assertion     # what this criterion's first failure should look like
allowed_paths: [src/auth/**, test/auth/**]
rollback:
  strategy: feature flag
blocking_questions: []
```

`gatectl spec compile` refuses, by name, anything a gate would otherwise have to guess at: a criterion
with no test, two criteria pointing at the same case, a duplicate or malformed id, an empty
`allowed_paths`, a rollback with no strategy, an unknown state. What it emits is the **Test
Obligations Manifest** — one entry per criterion, naming the exact run that proves it:

```
spec session-auth: compiles
  digest 4a9f2c8e1b3d7f60… (over the canonical form — formatting and key order do not move it)
  test obligations:
    AC-01 → test/auth.test.ts::"rejects an expired refresh token" (RED must be assertion)
```

The digest is over the **canonical** form, which is what makes it usable: reformat the YAML,
reorder keys, edit a comment — every gate result stands. Change a statement, and everything bound
to the old digest is stale, as it should be. Markdown specs still work; they simply digest over
their bytes, which is exactly the imprecision the compiler removes.

## RED that can be replayed, GREEN per criterion

"The tests were red before I wrote the code" is the claim TDD rests on, and until 0.13 gatectl took
it on the word of a working tree that no longer exists by the time anyone reads the evidence.
A replayable RED is a statement about two trees that both still exist:

```
base commit + only the test changes   → every criterion's test must FAIL, for its own reason
the final tree                        → the same test must PASS
```

```sh
gatectl red --base $(git merge-base origin/main HEAD)
#   gate R: PASS
#     replayed 8f2a1c9d4e7b + 1 test file(s) → tree 63c0a5e1f8d2…
#     ✓ AC-01 test/auth.test.ts::"rejects an expired refresh token" — assertion
gatectl green
#   gate GREEN: PASS
#     ✓ AC-01 test/auth.test.ts::"rejects an expired refresh token"
```

The point is that the first command still works **after** the implementation has landed. gatectl
rebuilds the base commit in a throwaway worktree, copies in only the test half of the diff, and
runs each criterion there. So does anyone else, later, from git alone — the evidence stops being
a memory and becomes an experiment someone can repeat.

Each criterion is judged on its own, against the failure kind it declared. `expected_red:
assertion` is the strict default; `load` is legitimate when the criterion is about an export that
does not exist yet and the file genuinely cannot be imported before the change. A criterion that
fails some other way is `NOT_EVALUATED` — a broken harness is not a red test — and one that
already passes at the base is `FAIL`: there was nothing to implement.

## The next step is derived, never stored

There is no `state:` field an agent can set, because a status an agent can write is one it will
write the moment it feels done. `gatectl next` computes the state from the compiled spec, the signed
ledger and the tree in front of it:

```sh
gatectl next --json
```
```json
{
  "state": "RED_PROVEN",
  "why": "RED is proven and nothing implements it yet",
  "next_command": "implement the change",
  "allowed_actions": ["implement"],
  "blocking_questions": []
}
```

Because it is derived, it falls back on its own: edit the tree after `gatectl green` and the state
returns to `IMPLEMENTING`; weaken a required test and it returns to `LOCKED`; change a statement
in the spec and it returns to the lock. An open `BLOCKING` question stops the protocol entirely
and offers no command at all — that decision is a person's.

## Gate X — accounting for every promise

Gate `L` has a model try to refute the **spec** before anything is built. Gate `X` asks one to
account for the **diff** once it exists — and the word is deliberate. The old rule was "a review
that found nothing is NOT_EVALUATED", aimed at the right problem (an empty page is
indistinguishable from a model that was never asked) but paying for findings. What you pay for
you get: invented nits, so the gate would go green.

So the reviewer is not asked to find something. It is asked to address **every acceptance
criterion and every invariant, by id**, with a verdict and with citations into the actual code:

```json
{
  "prompt_version": 2,
  "model": "…",
  "claims": [
    { "target": "AC-01", "verdict": "implemented",
      "reasoning": "expiry is compared against now before the token is returned",
      "citations": [ { "file": "src/auth/refresh.ts", "start_line": 41, "end_line": 47,
                       "quote": "  if (expired(token)) return null" } ] }
  ],
  "findings": [ { "id": "X-001", "severity": "high", "title": "…", "detail": "…" } ],
  "verdict": "APPROVE"
}
```

Finding nothing is now a legitimate outcome. Finding nothing while having looked at nothing is
not, and the difference is checkable:

| Situation | Answer |
| --- | --- |
| a criterion or invariant is not addressed | `NOT_EVALUATED` — name every id or the review is incomplete |
| a claim cites nothing | refused at shape check: an opinion is not a claim |
| a quote is not what is at those lines | `NOT_EVALUATED` — the citation is fabricated |
| no citation lands in the diff | `NOT_EVALUATED` — the review is not about this change |
| the reviewer says "unclear" or "not_implemented" | `NOT_EVALUATED` — an unconfirmed criterion is not green |
| the code moved after the review | `NOT_EVALUATED` — re-run it |
| the diff was reviewed by the model that wrote it | `NOT_EVALUATED` — an author does not review its own work |
| an unresolved critical/high finding | `FAIL`, named by its stable id |

A model cannot compute a git blob id, so it is not asked to. It quotes the lines it is talking
about; gatectl checks the quote against the file and stamps the digests itself. That closes the
interesting forgery — citing a line number that exists but says something else.

The rule is about the **author**, not about the critic. The spec critic and the diff reviewer may
be the same outside model — they look at different artifacts at different moments, and one
adversary that already argued with the spec is an asset. What is forbidden is the model that
wrote the code reviewing it. Policy names the implementer, and the reviewer reports its own
identity; gatectl compares the two:

```yaml
implementer:
  model: claude        # who writes the code here
critic:
  cli: codex           # argues with the spec, before anything is built
reviewer:
  cli: codex           # argues with the diff, after
```

**What is deterministic here, and what is not.** Deterministic: that the review is about this
tree and this spec, that every id is accounted for, that every citation names real code at the
line it claims, that at least one lands in the diff, that findings carry stable ids. Not
deterministic: whether the reasoning is any good. That is a model's judgement, it varies between
runs, and no schema makes it repeatable. gatectl binds it and checks its shape; it does not pretend
to verify its content.

### When a known problem ships anyway

Fixing a finding changes the code, which stales the review, which forces a fresh one — the loop
needs no bookkeeping. The one case that does is a finding you accept:

```sh
gatectl review accept X-001 --reason "shipping behind a flag, tracked in RSK-42"
```

That goes into the signed ledger, with the reason attached. Gate X then passes and says so out
loud, and six months later the record still answers the question of why a known problem shipped.

## The Completion Authority

`commit-check` answers a question about a **commit**: is this change safe to record. `gatectl
complete` answers a different one about a **feature**: is what the spec promised actually
delivered. Those come apart more often than they sound like they should — a feature can have
every gate green and still not be done.

```
completion: REJECT
  - every_criterion_is_green: test/auth.test.ts::"rejects an expired refresh token" does not pass (assertion)
  - attested_for_this_tree: the attestation is for a different tree
  ✓ AC1 test/auth.test.ts::"signs a user in"
```

It reads the Test Obligations Manifest and the ledger; it runs nothing. Seven predicates, each
of which holds or is named, all evaluated — a report that names one problem when there are four
costs three more rounds of asking:

| Predicate | Holds when |
| --- | --- |
| `spec_complete` | the spec compiles and carries every required section |
| `no_open_questions` | no `BLOCKING` question is still unanswered |
| `every_criterion_has_a_test` | the manifest is non-empty and every criterion is in it |
| `red_proven` | every criterion has replayed RED evidence, for this spec digest |
| `green_proven` | every criterion has GREEN evidence, for this spec digest and this tree |
| `commit_check_green` | gate C is green for this exact state |
| `attested_for_this_tree` | the attestation verifies and is for the tree in front of us |

The pair is the whole idea. RED alone is a test nobody made pass; GREEN alone is a test that may
never have been able to fail — the assertion that was always true, the case that never ran.
Requiring both, per criterion, by stable id, is what makes "done" mean something.

ACCEPT is the absence of failed predicates, never a positive opinion that the work is good. The
decision is signed, written beside the ledger, and recorded in it — so a REJECT is as permanent
a part of the record as an ACCEPT.

## The adversarial suite

`test/attack.test.mjs` is written as attacks rather than as features, because the claim being
tested is not "the gate works" but "this specific cheat is refused". Each of these is a passing
test today:

| Attack | Answer |
| --- | --- |
| delete the required test | `test file deleted:` — G-full fails |
| add `.only` / `.skip` | named in the diff, G-full fails |
| name a case nobody wrote | `executed no matching test` — NOT_EVALUATED, never RED |
| exit 0 without running anything | same — an empty run is not a pass |
| read the signing key from a test command | the variable does not exist in the child |
| inject a second command through a filename | argv, never a shell |
| edit the code after G-full | `stale tree` |
| leave an unstaged edit behind | `drifted from the index` |
| edit the policy | `meta-class file touched` |
| edit the CI workflow | `meta-class file touched` |
| forge a ledger entry | `not trustworthy` — gate C concludes nothing |
| invent an entry for a gate that never ran | `does not match its signature` |
| hide tier-A code under a wide glob | `tier escalated B → A` |
| add a path no tier claims | falls to tier A, never to the cheapest |
| forge the evidence envelope | signer refuses: `tree_oid` does not match the commit |
| hand the signer another run's artifact | refused: `workflow_run_id` |
| smuggle an extra field past the signer | refused: `unknown field` |
| relax the policy that judges the branch | refused before anything runs |

## Limits in v0.1

Stated plainly, because a gate engine that overstates its own authority is worse than none:

- **A runner that executes repository code can lie about the results.** The signer proves the
  evidence is about this commit and this policy; it cannot prove the test command really ran the
  tests. Closing that needs the commands to execute inside a disposable container with no
  network, no credentials and no writable path the evidence lives on — the next piece of work,
  not a property of today's signature.
- **Gate X does not run in the verifier yet.** The review is produced locally. A CI verdict
  names its command checks and explicitly lists the full gates in `not_rerun`. Independent review means the verifier calls the
  model itself on the final diff; until then X is a local gate.
- **Locally, the key and the agent share a machine.** The HMAC record is a real boundary against
  an agent editing its own evidence by accident or by shortcut; it is not one against an agent
  that reads `~/.gatectl/state/keys/`. That is why the local record is called a claim. The verdict
  that is meant to be believed is the issued one, and its key lives with the issuer.
- **`.gatectl/attest.pub` is only as trustworthy as the repository.** Anyone who can commit can
  replace it with their own public key and sign with the matching private one. gatectl uses it and
  says out loud that it did; a verifier that cares passes `--pubkey` or sets `GATECTL_ATTEST_PUBKEY`
  to a key it chose.
- **Hooks are bypassable.** `git commit --no-verify` walks around the pre-commit gate; that is
  what the CI-side `gatectl verify --rerun` is for.
- **The referee must not ship from the branch it referees.** The workflow template installs gatectl
  from a pinned external source on purpose. Installing it from the branch under test would let
  that branch replace its own referee.
- **"Cross-model" is checked by self-report.** gatectl compares the model each side names in its own
  output. Two CLIs pointed at the same underlying model that report different names would pass
  that check; pinning `critic.model` and `reviewer.model` to genuinely different models is a
  human decision gatectl records rather than enforces.
- **The environment record is shallow.** An attestation carries node version, platform, arch and
  the policy's commands as written — not a container image digest, a lockfile hash, or the
  resolved dependency tree. Two machines running the same commands against different dependency
  versions still look identical in the record; `--rerun` is what actually catches the difference.
- **`empty` detection is per-policy.** The shipped patterns cover vitest and the common
  "no test files found" phrasings. A runner that announces an empty run some other way needs its
  own pattern, and until it has one, an exit-0 named case is reported as ambiguous rather than
  green.

## Design lineage

`gatectl` is the executable core of a larger protocol for agentic, spec-driven development, and the
distinction matters when reading this repository: what runs is `bin/`, `src/` and `templates/`;
what is design is everything else.

The directories `docs/`, `spec/`, `schemas/`, `policies/`, and `examples/` at the repository
root are **protocol v1.1** — the full agentic spec-driven development control plane this engine
was designed against (adversarial review, cross-model verification, completion evidence,
budgets). Nothing in them has moved. `gatectl` (`bin/`, `src/`, `templates/`) is v0.1 of that
protocol's **executable core**: the deterministic gates (`L`, `R`, `G-fast`, `G-full`, `C`) that
protocol v1.1 describes. Gate `X` and the Completion Authority are no longer design-only: both
run, and both are documented above. What remains design rather than code is the budget and
orchestration layer, and the team-memory integration, which is optional and gates nothing. Start with `docs/01-architecture.md` for the full protocol; start with this file for what runs.

## Contributing

The engine gates its own development: every change here goes through the same chain it enforces,
and its specs live in `docs/specs/`. A pull request that adds behaviour is expected to bring the
criterion that was red before it, and the suite (`npm test`, 513 tests) includes an adversarial set
that tries to disarm the gates — deleting a required test, adding `.only`, forging a ledger entry,
replaying an old green onto a new tree. If you find a way past them, that is the most valuable
thing you can send.
