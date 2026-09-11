import { test } from 'vitest';
import { loadKey } from '../src/core/authority.mjs';
import { signAttestation } from '../src/core/attest.mjs';
import { appendEntry } from '../src/core/ledger.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const original = path.resolve('plugins/gatectl');
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-stop-regression-'));
  const root = path.join(dir, 'repo'), installed = path.join(dir, 'plugin');
  fs.mkdirSync(root); fs.cpSync(original, installed, {recursive:true});
  const env = {...process.env, GATECTL_STATE_DIR: path.join(dir,'state')};
  const hookEnv = {...env};
  const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git('init','-q','-b','main'); git('config','user.email','test@example.invalid'); git('config','user.name','Test');
  fs.writeFileSync(path.join(root,'check.mjs'),"import fs from 'node:fs'; if (!fs.readFileSync('docs/guide.md','utf8').includes('Guide')) process.exit(1);\n");
  git('add','.'); git('commit','-qm','baseline');
  const cli=(...args)=>spawnSync(process.execPath,[path.join(installed,'bin/gatectl.mjs'),...args,'--target',root],{cwd:root,env,encoding:'utf8'});
  assert.equal(cli('init','--client','codex').status,0);
  // Explicit test-fixture owner policy, not a change to any real repository.
  fs.writeFileSync(path.join(root,'.gatectl/policy.yaml'),`version: 1
unmatched_tier: C
tiers:
  C: {paths: ['docs/**'], requires: [Gfull]}
commands:
  typecheck: none
  build: none
  test_all: node check.mjs
implementer: {model: codex}
critic: {cli: claude, required_for_tiers: []}
reviewer: {cli: claude}
meta_class: ['.gatectl/**', 'docs/specs/**/spec.lock.json']
workflow: {mode: fast, cache: true, dependency_paths: [node_modules]}
`);
  git('add','.'); git('commit','-qm','fixture policy');
  const start = id => cli('task','start','guide','--session',id,'--client','codex');
  assert.equal(start('session').status,0);
  fs.writeFileSync(path.join(root,'docs/specs/guide/spec.yaml'),`id: guide
state: DRAFT
verification: policy
mvp_ref: maintenance
intent: Document installation.
invariants: [{id: INV-01, statement: Runtime unchanged.}]
acceptance_criteria: [{id: AC-01, statement: Installation documented.}]
allowed_paths: [docs/guide.md, docs/untracked.md]
rollback: {strategy: Revert guide.}
`);
  fs.writeFileSync(path.join(root,'docs/guide.md'),'Guide\n');
  const hook=(id='session',extra={})=>{
    const r=spawnSync(process.execPath,[path.join(installed,'bin/gatectl.mjs'),'hook'],{
      cwd:root,env:hookEnv,encoding:'utf8',input:JSON.stringify({cwd:root,session_id:id,hook_event_name:'Stop',...extra}),
    });
    assert.equal(r.status,0,r.stderr); return JSON.parse(r.stdout);
  };
  return {root,dir,installed,git,cli,hook,start,env,hookEnv};
}

test('bounds repeated status turns without accepting incomplete work', () => {
  const f=fixture();
  try {
    assert.equal(f.hook().decision,'block','first unfinished Stop reminds');
    const repeated=f.hook();
    assert.equal(repeated.decision,undefined,'new status turn must not restart the same loop');
    assert.match(repeated.systemMessage,/incomplete/);
    assert.notEqual(f.cli('finish').status,0,'suppression cannot satisfy finish');
    assert.equal(f.hook('session',{stop_hook_active:true}).decision,undefined);
    assert.equal(f.hook('unenrolled').decision,undefined);
    assert.equal(f.start('second').status,0);
    assert.equal(f.hook('second').decision,'block','sessions are independent');
    fs.appendFileSync(path.join(f.root,'docs/guide.md'),'First edit\n');
    assert.equal(f.hook().decision,'block','actual work rearms reminder');
    f.git('add','docs');
    fs.writeFileSync(path.join(f.root,'docs/untracked.md'),'new file');
    assert.equal(f.hook().decision,'block','untracked files rearm with staged work');
    fs.appendFileSync(path.join(f.root,'docs/guide.md'),'Unstaged edit\n');
    assert.equal(f.hook().decision,'block','unstaged edits are seen even with staged candidate');
    assert.equal(f.hook().decision,undefined);
    assert.equal(f.start('session').status,0);
    assert.equal(f.hook().decision,'block','explicit reenrollment rearms reminder');
    f.git('add','docs');
    assert.equal(f.hook().decision,'block','staging selects a new candidate before the check');
    const check=f.cli('check'); assert.equal(check.status,0,check.stdout+check.stderr);
    assert.equal(f.hook().decision,undefined,'gate progress without code changes does not restart the loop');
    assert.match(f.hook().systemMessage,/incomplete/,'checks alone do not establish completion');
    const ready=f.cli('ready-to-commit'); assert.equal(ready.status,0,ready.stdout+ready.stderr);
    const finish=f.cli('finish'); assert.equal(finish.status,0,finish.stdout+finish.stderr);
    assert.deepEqual(f.hook(),{},'real completion is still recognized');
    fs.appendFileSync(path.join(f.root,'docs/guide.md'),'Post-completion edit\n');
    assert.equal(f.hook().decision,'block');
    assert.notEqual(f.cli('finish').status,0,'edits invalidate completion');
  } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
}, 30000);

test('unhashable candidate retains original blocking behavior', () => {
  const f=fixture();
  try {
    assert.equal(f.hook().decision,'block');
    const blob=f.git('rev-parse','HEAD:check.mjs').trim();
    execFileSync('git',['update-index','--index-info'],{cwd:f.root,
      input:`100644 ${blob} 2\tconflict.txt\n100644 ${blob} 3\tconflict.txt\n`});
    assert.equal(f.hook().decision,'block','digest failure must not be reported as duplicate');
    assert.equal(f.hook().decision,'block');
    assert.notEqual(f.cli('finish').status,0);
  } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
}, 30000);

function sessionFile(f, id = 'session') {
  const basename = crypto.createHash('sha256').update(id).digest('hex') + '.json';
  const state = path.join(f.dir, 'state');
  const rel = fs.readdirSync(state, {recursive:true}).find(name =>
    path.basename(name) === basename && path.basename(path.dirname(name)) === 'sessions');
  assert.ok(rel, 'enrolled session file exists');
  return path.join(state, rel);
}

test('keeps reminder persistence separate from task state', () => {
  const f=fixture();
  try {
    const session=sessionFile(f), before=fs.readFileSync(session,'utf8');
    assert.equal(f.hook().decision,'block');
    assert.equal(fs.readFileSync(session,'utf8'),before,'hook cannot overwrite enrollment or pause');
    const marker=path.join(path.dirname(session),'reminders',path.basename(session));
    assert.equal(fs.existsSync(marker),true,'separate reminder must be persisted');
    assert.equal(f.hook().decision,undefined);
    assert.equal(f.cli('task','pause','--session','session','--reason','user cancelled').status,0);
    const paused=fs.readFileSync(session,'utf8');
    assert.deepEqual(f.hook(),{});
    assert.equal(fs.readFileSync(session,'utf8'),paused);
  } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
}, 30000);

test('unwritable reminder directory preserves the first block', () => {
  const f=fixture();
  try {
    const session=sessionFile(f), before=fs.readFileSync(session,'utf8');
    fs.writeFileSync(path.join(path.dirname(session),'reminders'),'not a directory');
    assert.equal(f.hook().decision,'block');
    assert.equal(f.hook().decision,'block');
    assert.equal(fs.readFileSync(session,'utf8'),before);
    assert.notEqual(f.cli('finish').status,0);
  } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
}, 30000);

test('does not memoize an unavailable next result', () => {
  const f=fixture();
  try {
    const bundle=path.join(f.installed,'bin/gatectl.mjs');
    const original=fs.readFileSync(bundle,'utf8');
    const firstNewline=original.indexOf('\n')+1;
    fs.writeFileSync(bundle,original.slice(0,firstNewline)+
      "if (process.argv[2] === 'next') process.exit(2);\n"+original.slice(firstNewline));
    assert.equal(f.hook().decision,'block');
    const session=sessionFile(f);
    const marker=path.join(path.dirname(session),'reminders',path.basename(session));
    assert.equal(fs.existsSync(marker),false,'unknown state cannot consume the evaluated reminder');
    fs.writeFileSync(bundle,original);
    const healthy=f.hook();
    assert.equal(healthy.decision,'block');
    assert.match(healthy.reason,/Next: gatectl check/);
    assert.equal(f.hook().decision,undefined);
  } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
}, 30000);

function acceptAndCommit(f) {
  fs.writeFileSync(path.join(f.root,'.git/info/exclude'), '.env.local\nnode_modules/\n');
  fs.writeFileSync(path.join(f.root,'.env.local'), 'FIXTURE_INPUT=one\n');
  fs.mkdirSync(path.join(f.root,'node_modules'));
  fs.writeFileSync(path.join(f.root,'node_modules/tool'),'fixture dependency');
  f.git('add','docs');
  for (const command of ['check','ready-to-commit','finish']) {
    const r=f.cli(command); assert.equal(r.status,0,r.stdout+r.stderr);
  }
  f.git('commit','-qm','accepted implementation');
  assert.equal(JSON.parse(f.cli('next','--json').stdout).state,'COMPLETED');
}

test('recognizes recorded completion across hook environments without granting new finish', () => {
  const f=fixture();
  try {
    acceptAndCommit(f);
    f.hookEnv.GATECTL_TEST_HOST_CONTEXT='hook transport';
    f.hookEnv._='/fixture/other-shell';
    assert.deepEqual(f.hook(),{},'host invocation environment does not undo accepted completion');
    f.env.GATECTL_TEST_HOST_CONTEXT='hook transport';
    f.env._='/fixture/other-shell';
    assert.equal(JSON.parse(f.cli('next','--recorded-completion','--json').stdout).state,'COMPLETED');
    const next=JSON.parse(f.cli('next','--json').stdout);
    assert.equal(next.state,'GREEN','normal next asks for checks, not nonexistent implementation');
    assert.match(next.next_command,/check/);
    assert.notEqual(f.cli('finish').status,0,'new finish still requires the actual execution environment');
    assert.equal(f.hook().decision,'block','a later failed finish supersedes prior acceptance');
    // Restore a staged diff at the exact same tree: check refuses an empty diff.
    f.git('reset','--soft','HEAD^');
    const changedCheck=f.cli('check');
    assert.equal(changedCheck.status,0,changedCheck.stdout+changedCheck.stderr);
    assert.doesNotMatch(changedCheck.stdout,/reused check/,'changed env must execute checks');
    const warmCheck=f.cli('check');
    assert.equal(warmCheck.status,0,warmCheck.stdout+warmCheck.stderr);
    assert.match(warmCheck.stdout,/reused check/,'same env may reuse the newly executed check');
  } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
}, 60000);

test('refuses stale or unauthenticated recorded completion', () => {
  const mutations = [
    f => fs.appendFileSync(path.join(f.root,'.env.local'),'CHANGED=yes\n'),
    f => fs.appendFileSync(path.join(f.root,'docs/guide.md'),'Changed code\n'),
    f => fs.appendFileSync(path.join(f.root,'node_modules/tool'),' changed dependency'),
    f => fs.appendFileSync(path.join(f.root,'docs/specs/guide/spec.yaml'),'# changed spec\n'),
    f => fs.appendFileSync(path.join(f.root,'.gatectl/policy.yaml'),'# changed policy\n'),
    f => {
      // Fixture owner creates an authentic legacy-format receipt, not a forgery.
      const state=path.join(f.dir,'state');
      const file=fs.readdirSync(state,{recursive:true}).find(p => p.endsWith('/completion.json'));
      assert.ok(file);
      const record=JSON.parse(fs.readFileSync(path.join(state,file),'utf8'));
      delete record.input_context;
      const {key}=loadKey(f.root,{env:f.env,create:false});
      const legacy=signAttestation(record,key);
      fs.writeFileSync(path.join(state,file),JSON.stringify(legacy));
      appendEntry(path.join(path.dirname(path.join(state,file)),'gates.jsonl'), {
        gate:'Complete',status:'PASS',digest:legacy.spec_digest,tree:legacy.tree,completion_mac:legacy.mac,
      },key);
    },
    f => {
      const state=path.join(f.dir,'state');
      const file=fs.readdirSync(state,{recursive:true}).find(p => p.endsWith('/completion.json'));
      assert.ok(file);
      fs.writeFileSync(path.join(state,file),'{}');
    },
  ];
  for (const mutate of mutations) {
    const f=fixture();
    try {
      acceptAndCommit(f);
      f.hookEnv.GATECTL_TEST_HOST_CONTEXT='hook transport';
      assert.deepEqual(f.hook(),{},'recognition is established before the mutation');
      mutate(f);
      assert.equal(f.hook().decision,'block','changed or unverifiable completion must not be accepted');
    } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
  }
}, 120000);
