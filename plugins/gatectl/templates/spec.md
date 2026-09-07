# {slug}

state: DRAFT
mvp_ref: REPLACE — an id from .gatectl/MVP.yaml, or "maintenance"

## Intent
Зачем сейчас, для кого, как выглядит успех, что НЕ делаем. Русский — ок.

## Invariants
- I1 …

## Acceptance Criteria
<!-- `required:` names the test that proves this criterion. Naming the file alone proves only
     that the file went red — a syntax error or an unrelated case does that too. Add ::"case"
     to bind the criterion to the exact test, and gate R runs that case and nothing else. -->
- AC1 given …, when …, then … — required: test/REPLACE.test.ts::"the case name"

## Allowed Paths
- src/REPLACE/**
- test/**

## Rollback
…
