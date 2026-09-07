import { describe, it, expect } from 'vitest'
import { gateGfull, diffChecks } from '../src/core/gates.mjs'
import { gateX, PROMPT_VERSION } from '../src/core/review.mjs'
import { nextStep } from '../src/core/next.mjs'
import { decideCompletion } from '../src/core/completion.mjs'

const finding = { id: 'X-001', severity: 'high', title: 'Missing validation', detail: 'new context' }
const review = { model: 'reviewer', prompt_version: PROMPT_VERSION, tree: 'tree', spec_digest: 'spec',
  claims: [{ target: 'AC-01', verdict: 'implemented', citations: [{ file: 'src/a.js', start_line: 1, end_line: 1, quote: 'const a = 1;' }] }], findings: [finding], verdict: 'CHANGES_REQUESTED' }
const reviewArgs = { review, compiled: { digest: 'spec', acceptance_criteria: [{ id: 'AC-01' }], invariants: [] }, tree: 'tree', changed: ['src/a.js'], implementer: 'author', readLines: () => ['const a = 1;'] }

describe('0.15 authority and policy regressions', () => {
  it('old exceptions cannot approve a new tree or spec', () => {
    expect(gateX({ ...reviewArgs, acceptances: [{ finding: finding.id, title: finding.title, digest: 'old-spec', tree: 'old-tree', reason: 'old exception' }] }).status).toBe('FAIL')
  })
  it('full gate executes the declared typecheck even when build and tests pass', () => {
    const result = gateGfull({ run: cmd => ({ code: cmd === 'tsc' ? 1 : 0, output: 'type error' }), policy: { commands: { typecheck: 'tsc', build: 'build', test_all: 'test' } }, changed: ['src/a.js'], diffText: '', spec: { allowedPaths: ['src/**'] }, specDir: 'docs/specs/demo' })
    expect(result.status).toBe('FAIL')
    expect(result.reasons.join()).toContain('typecheck')
  })
  it('an active spec directory is not a blanket meta-class exception', () => {
    expect(diffChecks({ changed: ['docs/specs/demo/spec.lock.json'], allowedPaths: ['src/**'], diffText: '', specDir: 'docs/specs/demo', metaClass: ['docs/specs/**/spec.lock.json'] }).join()).toContain('meta-class')
  })
  it('tier C follows its declared fast gate without fabricated RED', () => {
    expect(nextStep({ feature: { slug: 'docs' }, spec: { blockingQuestions: [] }, digest: 'd', tree: 't', requires: ['Gfast'], hasImplementation: true }).next_command).toBe('gatectl gate fast')
  })
  it('policy-only completion does not invent per-criterion RED requirements', () => {
    expect(decideCompletion({ spec: { missingSections: [], blockingQuestions: [], digest: 'd', tree: 't' }, obligations: [], requires: ['Gfast'], gateC: { status: 'PASS' }, attestation: { ok: true } }).decision).toBe('ACCEPT')
  })
})

import { reviewDigest } from '../src/core/review.mjs'
import { compileSpec, specFromCompiled } from '../src/core/spec-compile.mjs'
import { gateL } from '../src/core/gates.mjs'

describe('exception scope and policy-only specifications', () => {
  const acceptance = () => ({ finding: finding.id, title: finding.title, digest: 'spec', tree: 'tree', review_digest: reviewDigest(review), reason: 'Explicit owner exception' })
  it('accepts only the exact reviewed candidate and rejects changed detail with the same title', () => {
    expect(gateX({ ...reviewArgs, acceptances: [acceptance()] }).status).toBe('PASS')
    const changed = { ...review, findings: [{ ...finding, detail: 'A different affected endpoint' }] }
    expect(gateX({ ...reviewArgs, review: changed, acceptances: [acceptance()] }).status).toBe('FAIL')
    for (const field of ['digest', 'tree', 'review_digest', 'reason', 'title']) {
      const entry = acceptance(); delete entry[field]
      expect(gateX({ ...reviewArgs, acceptances: [entry] }).status, field).toBe('FAIL')
    }
  })
  it('a criterion exception expires with the candidate too', () => {
    const changed = { ...review, findings: [], claims: [{ ...review.claims[0], verdict: 'unclear' }] }
    const entry = { criterion: 'AC-01', tree: 'old', digest: 'spec', review_digest: reviewDigest(changed), reason: 'Accepted previously' }
    expect(gateX({ ...reviewArgs, review: changed, acceptances: [entry] }).status).toBe('NOT_EVALUATED')
    entry.tree = 'tree'
    expect(gateX({ ...reviewArgs, review: changed, acceptances: [entry] }).status).toBe('PASS')
  })
  it('arbitrary code under a spec directory is not bookkeeping', () => {
    expect(diffChecks({ changed: ['docs/specs/demo/runner.js'], allowedPaths: ['src/**'], diffText: '', specDir: 'docs/specs/demo', metaClass: [] }).join()).toContain('outside allowed_paths')
  })
  it('policy criteria compile but cannot pass a lock requiring RED after escalation', () => {
    const result = compileSpec({ id: 'docs', state: 'DRAFT', verification: 'policy', mvp_ref: 'maintenance', intent: 'Document installation', invariants: [{id:'INV-01',statement:'No runtime changes'}], acceptance_criteria: [{id:'AC-01',statement:'Installation documented'}], allowed_paths:['docs/**'], rollback:{strategy:'revert'} })
    expect(result.ok).toBe(true); expect(result.obligations).toEqual([])
    expect(gateL({spec:specFromCompiled(result.compiled),critique:null,tier:'A',policy:{tiers:{A:{requires:['L','R']}},critic:{required_for_tiers:[]}},mvp:null}).status).toBe('FAIL')
  })
  it('an unknown required gate cannot produce a completed next step', () => {
    expect(nextStep({ feature:{slug:'x'}, spec:{blockingQuestions:[]}, requires:['MadeUp'], hasImplementation:true, attested:true, completion:'ACCEPT' }).state).toBe('BLOCKED')
  })
})
