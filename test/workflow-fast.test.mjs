import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import yaml from 'js-yaml'
import { followUpErrors } from '../src/core/review.mjs'
import { cachedRunner } from '../src/core/check-cache.mjs'
import { configureWorkflow, readableCommand } from '../src/core/workflow.mjs'
const bin = path.resolve('bin/gatectl.mjs')
const roots = []
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-fast-')); roots.push(dir)
  const root = path.join(dir, 'repo'); fs.mkdirSync(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim()
  git('init','-q','-b','main'); git('config','user.email','test@example.invalid'); git('config','user.name','Test')
  fs.writeFileSync(path.join(root,'.gitignore'),'node_modules/\n'); fs.writeFileSync(path.join(root,'app.js'),'export const value = 1;\n')
  git('add','.'); git('commit','-qm','base')
  const env = { ...process.env, GATECTL_STATE_DIR: path.join(dir,'state') }
  const cli = (...args) => {
    const r = spawnSync(process.execPath,[bin,...args,'--target',root],{cwd:root,env,encoding:'utf8'})
    return {code:r.status,out:r.stdout,err:r.stderr}
  }
  return {dir,root,git,cli}
}
afterEach(()=>{ for (const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}) })
describe('fast workflow and exact execution reuse',()=>{
  it('does not silently drop or downgrade unresolved severe review findings',()=>{
    const prior={findings:[{id:'X-001',severity:'high'}]}
    expect(followUpErrors(prior,{findings:[]})).toHaveLength(1)
    expect(followUpErrors(prior,{findings:[{id:'X-001',severity:'low'}]})).toHaveLength(1)
    expect(followUpErrors(prior,{findings:[],resolved_findings:[{id:'X-001',reason:'The delta validates this input'}]})).toEqual([])
  })
  it('fast setup removes mandatory RED and strict setup retains it',()=>{
    const original={tiers:{A:{requires:['L','R','Gfull','X']}},critic:{required_for_tiers:['A']}}
    const fast=configureWorkflow(original,'fast')
    expect(fast.tiers.A.requires).toEqual(['Gfull','X'])
    expect(configureWorkflow(fast,'strict').tiers.A.requires).toEqual(original.tiers.A.requires)
    expect(original.critic.required_for_tiers).toEqual(['A'])
    expect(readableCommand('gatectl gate full')).toBe('gatectl check-all')
  })
  it('reuses identical expanded commands, invalidates code/dependencies/env, and never caches failures',()=>{
    const f=fixture(); let count=0, code=0
    const previous=process.env.GATECTL_STATE_DIR; process.env.GATECTL_STATE_DIR=path.join(f.dir,'cache')
    try {
      const policy={workflow:{mode:'fast'}}
      const options={execute:()=>{count++;return {code,output:'test result'}},announce:()=>{}}
      const run=cachedRunner(f.root,policy,options)
      run('node test.mjs {file}',{file:'a'}); run('node test.mjs a',{unused:'ignored'})
      expect(count).toBe(1)
      fs.appendFileSync(path.join(f.root,'app.js'),'// changed\n');run('node test.mjs a');expect(count).toBe(2)
      fs.mkdirSync(path.join(f.root,'node_modules'));fs.writeFileSync(path.join(f.root,'node_modules/dep.js'),'one');run('node test.mjs a');expect(count).toBe(3)
      fs.writeFileSync(path.join(f.root,'node_modules/dep.js'),'two');run('node test.mjs a');expect(count).toBe(4)
      process.env.GATECTL_TEST_INPUT='changed';run('node test.mjs a');expect(count).toBe(5)
      code=1;cachedRunner(f.root,policy,{...options,fresh:true})('node test.mjs a');run('node test.mjs a');expect(count).toBe(7)
    } finally { delete process.env.GATECTL_TEST_INPUT; if(previous===undefined)delete process.env.GATECTL_STATE_DIR;else process.env.GATECTL_STATE_DIR=previous }
  })
  it('runs related tests during work and shares final commands across GREEN/full without executing on next/finish',()=>{
    const f=fixture()
    expect(f.cli('init','--mode','strict').code).toBe(0)
    const countFile=path.join(f.dir,'calls')
    fs.writeFileSync(path.join(f.root,'check.mjs'),`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(countFile)},process.argv[2]+'\\n');`)
    const policy={version:1,workflow:{mode:'strict',cache:true},tiers:{A:{paths:['**'],requires:['Gfull']}},commands:{typecheck:'node check.mjs typecheck',build:'node check.mjs build',test_all:'node check.mjs test',test_file:'node check.mjs test',test_related:'node check.mjs related'},critic:{required_for_tiers:[]},meta_class:['.gatectl/**']}
    fs.writeFileSync(path.join(f.root,'.gatectl/policy.yaml'),yaml.dump(policy)); f.git('add','.'); f.git('commit','-qm','owner setup')
    expect(f.cli('new','example').code).toBe(0)
    fs.writeFileSync(path.join(f.root,'docs/specs/example/spec.yaml'),yaml.dump({id:'example',state:'DRAFT',mvp_ref:'maintenance',intent:'Change app',invariants:[{id:'INV-01',statement:'App works'}],acceptance_criteria:[{id:'AC-01',statement:'Test passes',test:{file:'app.test.js'}}],allowed_paths:['app.js','app.test.js'],rollback:{strategy:'revert'}}))
    fs.writeFileSync(path.join(f.root,'app.test.js'),'// fixture obligation checked by check.mjs\n')
    fs.appendFileSync(path.join(f.root,'app.js'),'// change\n');f.git('add','.')
    expect(f.cli('check-related').code).toBe(0)
    expect(fs.readFileSync(countFile,'utf8')).toBe('related\n')
    const green=f.cli('test-green');expect(green.code,green.err).toBe(0)
    const full=f.cli('check');expect(full.code,full.err).toBe(0);expect(full.out).toContain('reused check')
    expect(fs.readFileSync(countFile,'utf8').trim().split('\n').sort()).toEqual(['build','related','test','typecheck'])
    const count=fs.readFileSync(countFile,'utf8')
    expect(f.cli('ready-to-commit').code).toBe(0)
    expect(f.cli('finish').code).toBe(0)
    expect(JSON.parse(f.cli('next','--json').out).state).toBe('COMPLETED')
    expect(fs.readFileSync(countFile,'utf8')).toBe(count)
    fs.mkdirSync(path.join(f.root,'node_modules'));fs.writeFileSync(path.join(f.root,'node_modules/a'),'changed deps')
    expect(f.cli('finish').code).not.toBe(0)
    expect(fs.readFileSync(countFile,'utf8')).toBe(count)
  },30000)
  it('calls the reviewer once per candidate, then sends only the changed delta while preserving findings',()=>{
    const f=fixture(), counter=path.join(f.dir,'reviews'), prompts=path.join(f.dir,'prompt')
    const reviewer=path.join(f.dir,'reviewer.mjs')
    fs.writeFileSync(reviewer,`import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(counter)},'call\\n');
fs.writeFileSync(${JSON.stringify(prompts)},process.argv.at(-1));
const quote=fs.readFileSync('app.js','utf8').split('\\n')[0];
console.log(JSON.stringify({model:'independent',prompt_version:2,verdict:'APPROVE',findings:[],claims:['AC-01','INV-01'].map(target=>({target,verdict:'implemented',citations:[{file:'app.js',start_line:1,end_line:1,quote}]}))}));`)
    expect(f.cli('init').code).toBe(0)
    const policy={version:1,workflow:{mode:'fast'},tiers:{A:{paths:['**'],requires:['Gfull','X']}},implementer:{model:'author'},reviewer:{cli:process.execPath,args:[reviewer]},commands:{typecheck:'none',build:'none',test_all:'true'},meta_class:['.gatectl/**']}
    fs.writeFileSync(path.join(f.root,'.gatectl/policy.yaml'),yaml.dump(policy));f.git('add','.');f.git('commit','-qm','setup')
    expect(f.cli('new','reviewed').code).toBe(0)
    fs.writeFileSync(path.join(f.root,'docs/specs/reviewed/spec.yaml'),yaml.dump({id:'reviewed',state:'DRAFT',verification:'policy',mvp_ref:'maintenance',intent:'Change value',invariants:[{id:'INV-01',statement:'Valid JS'}],acceptance_criteria:[{id:'AC-01',statement:'Value updated'}],allowed_paths:['app.js'],rollback:{strategy:'revert'}}))
    fs.writeFileSync(path.join(f.root,'app.js'),'export const value = 2;\n');f.git('add','.')
    const first=f.cli('review');expect(first.code,first.err).toBe(0)
    expect(f.cli('review-check').code).toBe(0)
    expect(f.cli('review').out).toContain('Reused review')
    expect(fs.readFileSync(counter,'utf8')).toBe('call\n')
    fs.writeFileSync(path.join(f.root,'app.js'),'export const value = 3;\n');f.git('add','.')
    const second=f.cli('review');expect(second.code,second.err).toBe(0)
    expect(second.out).toContain('since previous review')
    expect(fs.readFileSync(counter,'utf8')).toBe('call\ncall\n')
    const prompt=fs.readFileSync(prompts,'utf8')
    expect(prompt).toContain('-export const value = 2;')
    expect(prompt).not.toContain('-export const value = 1;')
    expect(prompt).toContain('COMPLETE updated claims/findings')
    expect(f.cli('review-check').code).toBe(0)
  },30000)

})
