# Stop completion context

Reproduced in rsk0: a standalone next returns COMPLETED; invoking the same CLI
hook through Python returns 'no implementation'. The full inherited child env is
part of check receipts. A new host/shell invocation has a different environment;
after commit the clean diff then also looks like no implementation. This is not
a missing implementation and an unchanged accepted task should not trigger execution solely because the host process differs.

Keep all execution-context semantics for checks, ready and finish. Add an explicit
read-only next --recorded-completion path used by Stop: validate the signed
ACCEPT and attestation, latest authenticated ledger entry being Complete PASS with the exact completion MAC, exact tree/spec/
policy, no index drift, and a new input_context recorded by successful finish.
input_context uses the existing executionContext with an empty env: dependencies,
configured input files, runtime and policy remain bound. The recorded branch runs before normal currentResults/gateCContext and performs one input walk on the accepted path. No environment values
are stored, removed from command execution or treated as equivalent for caching.
A recognized record answers only that this unchanged task was accepted in its
recorded execution environment. It does not grant a new finish in the host env.

Legacy completions lack the file-input binding and cannot take the new path;
normal next evaluation remains the fallback. Re-running finish in the original
validated environment can add the binding without rerunning checks. An accepted
old tree must not be upgraded by fabricating or signing a receipt manually.

Normal next must say checks are stale instead of claiming no implementation when
its authenticated ledger already records passing tree-bound checks for the same
spec/tree. Corrupt/missing records, failures, source or file-input changes never
use the historical branch. Existing enrollment/pause rules remain unchanged.

Regression uses the actual bundled CLI and fixture-owner policy; proves finish
and commit then changes only hook env. Negative cases cover input files, code,
spec, policy, integrity and missing binding. Final release/install and rsk0
receipt refresh are separately verified post-acceptance actions.

## Reproduction evidence and failure handling

Read-only comparison on rsk0, 2026-09-10: direct Node vs Node spawned by Python
both use v23.3.0 at /opt/homebrew/Cellar/node/23.3.0/bin/node, state
/Users/nick/.gatectl/state/rsk0-web-759194b8041e and the same filesystem key source.
No environment key override or state-root difference occurred in this reproduction.
Their executionContext digests differ; executionContext with empty env is identical
(85b202870d2d5235c7178b16a94aee270c9295a0c7f56271bab29eafd56ef1b9).
Record: /tmp/gatectl-context-comparison.json (no credential values). Thus runtime
binding is retained. A genuinely different runtime remains a named limitation:
recognition refuses it; this change does not declare runtimes interchangeable.

AC-01 also asserts plain next under the changed environment requests checks and
next --recorded-completion explicitly reports COMPLETED before a new finish is
attempted. This changes commands.mjs's hasImplementation input using authenticated
historical checks; next.mjs itself need not change. A failed later finish is not
hidden: it supersedes acceptance and recovery requires checks/finish in a valid
execution environment. Fallback for genuine stale inputs remains normal next,
including a check request; only unchanged accepted task recognition skips it.

AC-02 uses gitignored .env.local and node_modules/tool so file binding is tested
independently of tree identity. An authentic fixture-owner signed legacy record
without input_context tests missing binding separately from a broken signature.
Later ledger entries (including FAIL) prevent recognition even if an old signed
completion file is restored. No unsigned session flag controls this decision.

Release 0.16.3 will be a separate metadata/release spec after this runtime fix is
accepted. This spec rebuilds the bundle at the existing development version only.
The live rsk0 post-install probe must exercise the same Python invocation within
the unchanged 10-second child timeout. No timeout or policy is increased.
