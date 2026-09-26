---
name: context
description: Keep the goal, findings, attempts and next step of non-trivial work in gatectl's local work store, so a new session continues instead of starting over and a failed attempt is not repeated. Use when starting or resuming multi-step work, investigating an unknown, before retrying something, and before ending a session, in repositories with .gatectl/policy.yaml.
---

# Work context through gatectl

`gatectl work` keeps a per-worktree record of questions, attempts, conclusions and checkpoints.
It is context for continuing work. It never proves anything: only `finish` exit 0 permits a completion
claim. Run the bundled CLI as in the delivery skill: `node <plugin-root>/bin/gatectl.mjs work ... --target <repo>`.

For a small, clear edit, skip all of this. Use it when the work spans sessions, has unknowns, or
has already failed once.

## The owner's goal

`docs/goal.yaml` holds the project goal every session starts from (SessionStart shows it first).
When there is none, or the owner's intent changed, draft it from the owner's own words — do not
substitute a narrower goal:

`goal propose --goal <formulation> --owner-words "<verbatim quote>"... --success <criterion>... --out-of-scope <x>...`

Show the owner the draft in plain language and the exact confirmation line it prints
(`подтверждаю цель G-…`). Only after they send that line, run `goal confirm`. Never write or edit a
confirmation yourself; a refusal or a "да" is not that message. Status other than `confirmed`
means the goal is not agreed: say so when you report. Commit docs/goal.yaml separately.

## Start or resume

Read `work brief` first (SessionStart may already have injected it). Continue from its goal and
next action; do not re-investigate recorded conclusions that are still `current`. Recheck `stale`
ones before relying on them; `unknown` freshness means nothing ties them to files.

Handle interrupted attempts first: record their result, or state why a new attempt starts.

## Investigate

- One question per unknown: `work ask "<question>"`. A choice only the owner can make is
  `--decision`; prepare the options and their consequences, then ask the owner.
- Before an experiment: `work try Q-n --hypothesis <h> --action <a> --input <file>...`. Name the
  files the attempt depends on; without inputs the whole working tree is the input.
- `REPEAT_ATTEMPT`, `INTERRUPTED_ATTEMPT` and `BUDGET_EXHAUSTED` are refusals. Do not rephrase the same
  attempt to get past them. Use `--reason` only for a real new basis (changed inputs outside the
  listed files, an insufficient earlier check). When the budget is exhausted: change the hypothesis,
  ask for an independent review, or report the concrete blocker.
- After it: `work result A-n --outcome progress|no_progress|answered|blocked --result <what happened>`.
  Add `--conclusion` with an honest `--kind`: `fact` only when extracted from a named source, `check`
  for a verification result, otherwise `hypothesis` (the default). Your inference is not a fact.
- Facts learned outside an attempt: `work note "<statement>" --kind ... --input <file>`.
- The owner's answer: `work answer Q-n "<answer>" --by user`.

## Checkpoint

At a stage boundary and before the session ends:
`work checkpoint --next "<next concrete action>" [--goal <goal>] [--done-when <condition>]`.
The goal carries forward; set it from the owner's words, not a narrower substitute.

## Readiness of the product

`gatectl capabilities [--goal <id>]` maps every feature to the owner's MVP goals from recorded
evidence: locked spec, gatectl acceptance (at the current tree, an earlier tree or an earlier spec
revision), whether each criterion's test exists, and whether it passed on this exact version.
Use it before proposing what to build next and when the owner asks "what actually works".
`--run` executes tests not yet proven on this version (it can be slow; narrow it with `--goal`).
Never describe "accepted at an earlier tree" or "not run on this version" as working now.

## Report to the owner

Keep it to four points, in the owner's language: what we are solving, what is established (and
how), what is next, which decision is needed from them. Do not show internal ids unless asked.

## Diagnose

`STORE_UNREADABLE` or `STORE_TOO_NEW`: the store was left untouched; report it, do not delete it.
`work path` shows its location; `work export` / `work import` back it up and restore into an empty
store. `SQLITE_UNAVAILABLE`: Node lacks node:sqlite (need >= 22.13, or 22.5+); gates still work.
