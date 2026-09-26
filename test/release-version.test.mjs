import { test, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { execFileSync, spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
test('keeps every distributed version aligned', () => {
  const version = read('package.json').version
  expect(version).toBe('0.18.0')
  expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  const heading = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').match(/^## (\S+) — (\d{4}-\d{2}-\d{2})$/m)
  expect(heading?.[1]).toBe(version)
  const lock = read('package-lock.json')
  for (const file of ['plugins/gatectl/package.json', 'plugins/gatectl/.codex-plugin/plugin.json', 'plugins/gatectl/.claude-plugin/plugin.json'])
    expect(read(file).version, file).toBe(version)
  expect(lock.version).toBe(version)
  expect(lock.packages[''].version).toBe(version)
  expect(read('.claude-plugin/marketplace.json').plugins.find(p => p.name === 'gatectl').version).toBe(version)
  // Every job that checks out the gatectl engine pins this release, and the plugin ships the same file.
  const template = fs.readFileSync(path.join(root, 'templates/ci/gatectl-verify.yml'), 'utf8')
  expect(fs.readFileSync(path.join(root, 'plugins/gatectl/templates/ci/gatectl-verify.yml'), 'utf8')).toBe(template)
  const jobs = Object.entries(yaml.load(template).jobs)
  expect(jobs.length).toBeGreaterThan(1)
  for (const [name, job] of jobs) {
    const engine = job.steps.filter(s => String(s.uses ?? '').startsWith('actions/checkout') && s.with?.repository === 'rsk0-app/gatectl')
    expect(engine.length, name).toBe(1)
    expect(engine[0].with.ref, name).toBe(`v${version}`)
  }
})

test('release notes describe what 0.18.0 ships', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## 0.18.0 — ')
  expect(start).toBeGreaterThan(-1)
  const section = changelog.slice(start, changelog.indexOf('\n## ', start + 1))
  for (const shipped of ['gatectl goal', 'gatectl capabilities', 'EPIPE']) expect(section, shipped).toContain(shipped)
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  expect(readme).toContain('gatectl goal propose')
  expect(readme).toContain('gatectl capabilities')
  expect(readme).not.toMatch(/\(unreleased\)/i)
})

test('the installed 0.18.0 plugin ships goal and capabilities', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-release-'))
  const installed = path.join(dir, 'plugin'), repo = path.join(dir, 'repo')
  fs.cpSync(path.join(root, 'plugins/gatectl'), installed, { recursive: true })
  fs.mkdirSync(path.join(repo, '.gatectl'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git('init', '-q', '-b', 'main'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  fs.writeFileSync(path.join(repo, '.gatectl/policy.yaml'), 'version: 1\ntiers: {}\n')
  const env = { ...process.env, GATECTL_STATE_DIR: path.join(dir, 'state'), CLAUDE_PLUGIN_ROOT: installed }
  const cli = path.join(installed, 'bin/gatectl.mjs')
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--target', repo], { env, encoding: 'utf8' })
  expect(spawnSync(process.execPath, [cli, 'version'], { encoding: 'utf8' }).stdout.trim()).toBe('0.18.0')
  expect(run('goal', 'propose', '--goal', 'ship the release', '--owner-words', 'ship it').status).toBe(0)
  const map = run('capabilities', '--json')
  expect(map.status, map.stderr).toBe(0)
  expect(JSON.parse(map.stdout).groups).toBeInstanceOf(Array)
  // The command the host runs, as registered in the shipped hooks.json.
  const registered = JSON.parse(fs.readFileSync(path.join(installed, 'hooks/hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command
  const hook = spawnSync('/bin/sh', ['-c', registered], { cwd: repo, env, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: repo, session_id: 's' }) })
  expect(hook.status, hook.stderr).toBe(0)
  expect(JSON.parse(hook.stdout).hookSpecificOutput.additionalContext).toContain('Owner goal [draft — not confirmed by the owner]: ship the release')
}, 60000)
