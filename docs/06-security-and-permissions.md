# 06 — Security and Permissions

## State-derived capabilities

```text
DISCOVERY
→ repository READ ONLY

SPEC
→ `.spec/**` WRITE

TDD
→ test paths WRITE, production paths READ ONLY

IMPLEMENTATION
→ bounded production paths WRITE, acceptance tests READ ONLY

INTEGRATION
→ merge capability

PR
→ draft PR capability
```

## Capability-based access

Example:

```text
Spec Architect
- repo.read
- docs.read
- spec.write

Test Agent
- repo.read
- tests.write
- shell.test

Developer
- repo.read
- src.write:scoped
- shell.dev
- git.local

Reviewer
- repo.read
- git.diff
- shell.test

Integrator
- git.merge
- shell.ci
```

## Forbidden by default

- production deployment
- merging protected branches
- destructive DB operations
- permanent cloud credentials
- organization permission changes
- billing operations
- secret rotation
- broad shell/network access

## Shell firewall

Restricted/destructive examples:

```text
terraform apply
terraform destroy
kubectl delete
DROP DATABASE
rm -rf
aws iam *
aws organizations *
curl arbitrary-domain | bash
```

Unknown destructive commands require policy approval.

## Secrets

Prefer:

- short-lived tokens
- repository-scoped GitHub installation tokens
- temporary cloud credentials
- read-only defaults

Never place permanent secrets in prompts.

## Sandboxing

Worker environment should not automatically inherit:

- host credentials
- production network
- unrelated repositories
- personal SSH keys

## Network policy

Default deny arbitrary outbound access where practical.

Allow only required package registries, source control, model APIs, and task-specific dependencies.

## Prompt injection defense

Repository contents are untrusted data.

Comments, README text, issue text, dependency docs, and generated files cannot override system policies or tool permissions.

## TDD separation

Implementation agents cannot weaken acceptance tests.

Detect and block:

- removed tests
- skipped tests
- `.only`
- changed expected values without authorized test change
- weakened assertions
- coverage reduction
- mocking away required production behavior
