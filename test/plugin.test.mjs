import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { hookResponse } from '../src/cli/plugin-hook.mjs'

const plugin = path.resolve('plugins/gatectl')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-plugin-'))
function fixture() {
  const dir = tmp(), root = path.join(dir, 'target'), installed = path.join(dir, 'installed-plugin')
  fs.mkdirSync(root); fs.cpSync(plugin, installed, { recursive: true })
  const env = { ...process.env, GATECTL_STATE_DIR: path.join(dir, 'state') }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })
  git('init','-q','-b','main'); git('config','user.email','test@example.invalid'); git('config','user.name','Test')
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({ name:'fixture',private:true,scripts:{} }))
  git('add','.'); git('commit','-qm','baseline')
  const cli = (...args) => {
    const r=spawnSync(process.execPath,[path.join(installed,'bin/gatectl.mjs'),...args,'--target',root],{cwd:root,env,encoding:'utf8'})
    return { code:r.status, out:r.stdout, err:r.stderr }
  }
  const hook = input => {
    const r=spawnSync(process.execPath,[path.join(installed,'bin/gatectl.mjs'),'hook'],{cwd:root,env,input:JSON.stringify({cwd:root,session_id:'session',...input}),encoding:'utf8'})
    expect(r.status,r.stderr).toBe(0); return JSON.parse(r.stdout)
  }
  return {root,installed,git,cli,hook}
}

describe('shared plugin hook protocol',()=>{
  const context={ root:'/repo', cli:'node /plugin/bin/gatectl.mjs', session:{slug:'task'}, next:{state:'IMPLEMENTING',why:'missing green',next_command:'gatectl green'} }
  it('ordinary prompts get workflow context without being blocked',()=>{
    const result=hookResponse({hook_event_name:'UserPromptSubmit',session_id:'a',prompt:'сделай задачу'},context)
    expect(result.decision).toBeUndefined()
    expect(result.hookSpecificOutput.additionalContext).toContain('task start')
  })
  it('unenrolled questions and paused tasks do not block Stop',()=>{
    expect(hookResponse({hook_event_name:'Stop'},{...context,session:null})).toEqual({})
    expect(hookResponse({hook_event_name:'Stop'},{...context,session:{paused:true}})).toEqual({})
  })
  it('pending tasks continue once, without claiming success on the retry',()=>{
    expect(hookResponse({hook_event_name:'Stop'},context).decision).toBe('block')
    const retry=hookResponse({hook_event_name:'Stop',stop_hook_active:true},context)
    expect(retry.decision).toBeUndefined(); expect(retry.systemMessage).toContain('incomplete')
  })
  it('missing evidence is not a completed task and human blockers terminate the loop',()=>{
    expect(hookResponse({hook_event_name:'Stop'},{...context,next:null}).decision).toBe('block')
    const result=hookResponse({hook_event_name:'Stop'},{...context,next:{state:'BLOCKED',why:'which environment?'}})
    expect(result.decision).toBeUndefined(); expect(result.systemMessage).toContain('which environment?')
  })
  it('completed tasks and plan mode may finish',()=>{
    expect(hookResponse({hook_event_name:'Stop'},{...context,next:{state:'COMPLETED'}})).toEqual({})
    expect(hookResponse({hook_event_name:'Stop',permission_mode:'plan'},context)).toEqual({})
  })
})

describe('installed plugin runtime without a global CLI or node_modules',()=>{
  it('does nothing in repositories that have not opted in',()=>{
    const f=fixture(); expect(f.hook({hook_event_name:'SessionStart'})).toEqual({})
    expect(f.cli('version')).toMatchObject({code:0,out:'0.16.0\n'})
    expect(fs.existsSync(path.join(f.installed,'node_modules'))).toBe(false)
  })
  it('runs a complete tier C task and rejects edits after completion',()=>{
    const f=fixture()
    expect(f.cli('init','--client','codex').code).toBe(0)
    // Fixture owner's explicit policy: no typecheck/build; a real docs verification command.
    fs.writeFileSync(path.join(f.root,'.gatectl/policy.yaml'),`version: 1
unmatched_tier: A
tiers:
  A: {paths: ["src/**"], requires: [L, R, Gfull, X]}
  C: {paths: ["docs/**"], requires: [Gfast]}
commands:
  typecheck: none
  test_related: 'node check-doc.mjs {files}'
implementer: {model: codex}
critic: {cli: claude, required_for_tiers: [A]}
reviewer: {cli: claude}
meta_class: [".gatectl/**", "docs/specs/**/spec.lock.json"]
`)
    fs.writeFileSync(path.join(f.root,'check-doc.mjs'),`import fs from 'node:fs'; if (!fs.readFileSync('docs/guide.md','utf8').includes('Install gatectl')) process.exit(1);`)
    f.git('add','.'); f.git('commit','-qm','owner setup')
    expect(f.hook({hook_event_name:'UserPromptSubmit',prompt:'сделай задачу'}).hookSpecificOutput.additionalContext).toContain('gatectl')
    expect(f.cli('task','start','guide','--session','session','--client','codex').code).toBe(0)
    fs.writeFileSync(path.join(f.root,'docs/specs/guide/spec.yaml'),`id: guide
state: DRAFT
mvp_ref: maintenance
verification: policy
intent: Explain installation.
invariants: [{id: INV-01, statement: Runtime is unchanged.}]
acceptance_criteria: [{id: AC-01, statement: Installation is documented.}]
allowed_paths: [docs/guide.md]
rollback: {strategy: Revert the guide.}
`)
    fs.writeFileSync(path.join(f.root,'docs/guide.md'),'Install gatectl\n')
    const step=()=>JSON.parse(f.cli('next','--json').out)
    expect(step().next_command).toBe('gatectl check')
    expect(f.hook({hook_event_name:'Stop'}).decision).toBe('block')
    f.git('add','docs')
    expect(f.cli('gate','fast').code).toBe(0)
    expect(f.cli('commit-check').code).toBe(0)
    expect(f.cli('complete')).toMatchObject({code:0})
    expect(step().state).toBe('COMPLETED')
    expect(f.hook({hook_event_name:'Stop'})).toEqual({})
    expect(f.hook({hook_event_name:'Stop',stop_hook_active:true})).toEqual({})
    f.git('commit','-qm','document installation')
    expect(step().state).toBe('COMPLETED')
    fs.appendFileSync(path.join(f.root,'docs/guide.md'),'Edited after approval\n')
    expect(step().state).not.toBe('COMPLETED')
    f.git('add','docs')
    expect(step().state).not.toBe('COMPLETED')
    expect(f.cli('complete').code).not.toBe(0)
    expect(f.cli('task','pause','--session','session','--reason','user cancelled').code).toBe(0)
    expect(f.hook({hook_event_name:'Stop'})).toEqual({})
  }, 30000)
  it('sets the opposite reviewer for each client and preserves existing policy',()=>{
    for (const client of ['codex','claude']) {
      const f=fixture(); expect(f.cli('init','--client',client).code).toBe(0)
      const file=path.join(f.root,'.gatectl/policy.yaml'),before=fs.readFileSync(file,'utf8')
      expect(before).toContain(`model: ${client}`)
      expect(before).toContain(`cli: ${client==='codex'?'claude':'codex'}`)
      expect(f.cli('init','--client',client==='codex'?'claude':'codex').code).toBe(0)
      expect(fs.readFileSync(file,'utf8')).toBe(before)
      expect(f.cli('task','start','task','--session','s','--client',client==='codex'?'claude':'codex').code).toBe(2)
    }
  })
})
