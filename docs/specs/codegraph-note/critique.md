# Critique — codegraph-note

- provider: openai
- model: undefined

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Registration call is not defined

SEVERITY: critical

A developer must document “the one-time registration call,” but the specification provides no endpoint, HTTP method, payload schema, repository identifier, authentication mechanism, or expected response. They can add any syntactically valid `curl`, the named test can pass, and users will execute a request that fails or registers the wrong resource. Fix: specify the exact command template, required variables, authoritative API/version, success response, and verification command.


RESOLVED: The spec's Notes section now carries the exact call — POST {endpoint}/code-graph/create, required team_id and repo_url, branch defaulting to main, both auth headers, and the pending/status flow. Taken from the service's openapi.yaml, not from memory.
## 2. “One-time” is unsafe without idempotency semantics

SEVERITY: high

A human runs the documented command, loses the response, and retries. If CodeGraph registration is not idempotent, the repository may be duplicated or the retry may fail with a conflict; the README would still claim the operation is one-time without explaining recovery. Fix: define the idempotency behavior, how to detect an existing registration, and the safe retry/re-registration procedure.


RESOLVED: Stated explicitly. The call is idempotent on (service_id, team_id, repo_url, branch); a repeat returns the existing record with HTTP 200 rather than creating a second, so a lost response is safely retried. That is now in the spec and must reach the README.
## 3. Repository identity and execution context are ambiguous

SEVERITY: high

A user copies the command while standing in the `rda` repository, although they intend to register `/work/target-repo`. A command based on `$PWD`, the current Git remote, or implicit repository discovery registers `rda` instead of the target. Fix: require an explicit target path and canonical remote/repository ID, state where the command runs, and include a preflight check that prints the repository being registered.


RESOLVED: repo_url is the identifier and branch defaults to main; both are named in the spec. Execution context is a human operator with TDAM_API_KEY and TDAM_SERVICE_ID exported — the same credential rule the memory integration already follows.
## 4. Credential handling is unconstrained

SEVERITY: high

An implementer satisfies the criterion with `curl -H 'Authorization: Bearer real-token' ...`, or places a token directly in shell history and copied logs. Registration works, but credentials leak through the committed README, process inspection, CI output, or terminal history. Fix: mandate placeholder-only documentation, name the environment variable or credential helper, prohibit literal secrets, and test that the example contains no credential value.


RESOLVED: Credentials come from the environment only, never from .rda/policy.yaml, which is committed. Stated in the spec and required in the README text.
## 5. The acceptance test can prove only text presence

SEVERITY: high

`test/readme-codegraph.test.mjs` can merely assert that README contains `curl` and “CodeGraph.” A dead endpoint, missing payload, placeholder repository, agent-executable instruction, or a statement that `rda` performs registration would still pass. Fix: enumerate testable requirements: exact endpoint/method shape, explicit target identifier, credential placeholder, human ownership, agent-consumer wording, and explicit prohibition of `rda` registration.


RESOLVED: The acceptance criteria now enumerate what the test must find — endpoint, required fields, credential source, idempotency guarantee — and a second criterion covers the src/ scan, so text presence alone cannot satisfy either.
## 6. The “no code path” invariant is not enforced

SEVERITY: high

The allowed implementation could add a README note and a passing README test while an existing or later `rda` command imports a CodeGraph client or invokes the registration endpoint. The acceptance criterion would remain green despite violating the central invariant. Fix: require a boundary test that scans executable paths, dependencies, commands, and network adapters for CodeGraph integration, similar to the existing memory-boundary test.


RESOLVED: Promoted to its own acceptance criterion and its own invariant. test/readme-codegraph.test.mjs scans src/ for any CodeGraph reference and fails if one appears, mirroring test/memory-boundary.test.mjs. The invariant is machine-checked, not asserted in prose.
## 7. Human registration and agent consumption lack an operational handoff

SEVERITY: medium

A human registers the repository successfully, but agents receive no documented registration ID, configuration location, discovery mechanism, or readiness check. Agents then cannot consume CodeGraph, or query a different repository, even though both stated invariants appear satisfied. Fix: specify where the resulting identifier is stored, how agents discover it, who may update it, and how an agent verifies the graph is ready before use.

## 8. The declared out-of-scope list is unresolved

SEVERITY: high

The project’s only declared exclusion is the placeholder “Replace me: what we are explicitly NOT building before launch.” Because no real boundary exists, reviewers cannot determine whether CodeGraph registration documentation, agent consumption, credential setup, or readiness checks contradict launch scope. Fix: replace the placeholder with an approved, concrete out-of-scope list before this specification can be locked, then explicitly map this change against it.


RESOLVED: .rda/MVP.yaml no longer carries the template placeholder — the owner approved a real out_of_scope list on 2026-08-20. The spec's Notes map this change against it: documentation of a boundary the list already draws, adding no networked gate and no rda code path.
## 9. Allowed test scope permits unrelated weakening

SEVERITY: medium

`test/**` authorizes modification or deletion of every test. An implementation can weaken existing gate, memory, or CLI tests while adding the required README test, creating unrelated regressions under the specification’s permitted diff. Fix: restrict allowed paths to `README.md` and the single new `test/readme-codegraph.test.mjs`, or explicitly require all pre-existing tests to remain semantically unchanged.

## 10. Rollback leaves the required test behind

SEVERITY: medium

The rollback says only “Revert the README section.” Doing that while retaining the required test makes the suite fail; deleting or weakening the test would exceed the stated rollback procedure. Fix: define rollback as reverting both the README section and `test/readme-codegraph.test.mjs`, plus any snapshots or fixtures introduced by the change.

## 11. No documentation placement is specified

SEVERITY: medium

An implementer can append the command to an unrelated README section, such as design lineage, where operators will not find it during setup. The named test can still pass and the step remains effectively “lost in conversation.” Fix: require a dedicated CodeGraph subsection in the target-repository setup or prerequisites flow, with a link from the primary installation path.

## 12. “Agents consume CodeGraph” overstates an absent capability

SEVERITY: medium

The README may tell agents to consume CodeGraph without specifying an installed tool, API, permission, or workflow. An agent follows the documentation, has no CodeGraph access, and either fails or invents results. Fix: name the supported consumer interface and prerequisites, or narrow the statement to conditional language describing consumption only when the CodeGraph integration is available.
