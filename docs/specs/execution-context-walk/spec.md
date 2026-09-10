# Dependency fingerprint traversal

Stop kills next at ten seconds; rsk0 next takes about twelve seconds. Repeated realpath calls resolve every ancestor for every dependency entry. Carry the resolved parent path into ordinary children and resolve only symlinks, retaining the exact legacy digest. Verify equivalence with a reference implementation and exercise aliases, cycles, missing files and metadata changes. Measure the actual rsk0 tree after implementation. This does not address environmental differences between host processes.

Each configured root is resolved using JS realpathSync even when only an ancestor is a symlink. Ordinary children inherit the canonical parent path; symlinks resolve with JS realpathSync and record target stat metadata. Dangling links and absent or ENOTDIR configured paths are omitted as before. Directory listing errors propagate. Before/after check scans stay independent to detect mutations.

The equivalence oracle copies the walker from commit 6527cc3; do not adapt it to new behavior. Tests include symlinked roots, file and directory aliases, cycles, dangling children, invalid roots, target mutations, input and environment changes. Count both JS and native realpath calls. Final digest equality covers the complete canonical tuple sequence.

Manual acceptance on rsk0: source next returns COMPLETED; Stop from the project directory returns {} within the existing ten-second child budget. Initial fixed context scan measured 0.97 seconds. Repeat a timed complete hook before installation. This stage installs a local version with the official Codex cachebuster, aligned across CLI and both plugin manifests; it does not claim a published release. Existing thread hooks can retain the old installation until a new thread.

Final scope: Codex local installation only; Claude marketplace distribution is not claimed in this task. Both bundled runtime manifests carry the local build version, but the public Claude marketplace remains at the published release. Rollback requires generating a fresh cachebuster and reinstalling the reverted bundle.

Legacy existsSync suppresses errors before stat/realpath; the new child lstat suppresses those same errors, including EACCES and ENAMETOOLONG. Stat/realpath races after a successful existence check and readdir failures still propagate, exactly as before. A permission regression fixture checks a readable but unsearchable directory on non-root POSIX hosts.

Measured on enrolled, unpaused rsk0 session 01a0851f-a5aa-7792-a621-1978d85729de with ACTIVE canonical-candidate-preflight: old scan 4.582s, new scan 1.092s, digests equal in the same process/environment; full bundled Stop returned {} in 8.839s under concurrent checks, below its ten-second child timeout. Direct source next returned COMPLETED. These manual measurements are not a universal latency guarantee. Automated acceptance bounds resolution calls and checks digest equality.
