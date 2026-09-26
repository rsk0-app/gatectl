import { test, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
test('keeps every distributed version aligned', () => {
  const version = read('package.json').version
  expect(version).toBe('0.17.0')
  expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  const heading = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').match(/^## (\S+) — (\d{4}-\d{2}-\d{2})$/m)
  expect(heading?.[1]).toBe(version)
  const lock = read('package-lock.json')
  for (const file of ['plugins/gatectl/package.json', 'plugins/gatectl/.codex-plugin/plugin.json', 'plugins/gatectl/.claude-plugin/plugin.json'])
    expect(read(file).version, file).toBe(version)
  expect(lock.version).toBe(version)
  expect(lock.packages[''].version).toBe(version)
  expect(read('.claude-plugin/marketplace.json').plugins.find(p => p.name === 'gatectl').version).toBe(version)
})

test('release notes describe what 0.17.0 ships', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## 0.17.0 — ')
  expect(start).toBeGreaterThan(-1)
  const section = changelog.slice(start, changelog.indexOf('\n## ', start + 1))
  for (const shipped of ['gatectl work', 'Loop guard', 'context', 'verify', 'review.json']) expect(section, shipped).toContain(shipped)
  expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).not.toMatch(/Work context \(unreleased\)/)
})

test('the installed plugin ships the work layer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-release-'))
  const installed = path.join(dir, 'plugin'), repo = path.join(dir, 'repo')
  fs.cpSync(path.join(root, 'plugins/gatectl'), installed, { recursive: true })
  for (const kind of ['.codex-plugin', '.claude-plugin']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(installed, kind, 'plugin.json'), 'utf8'))
    const skills = manifest.skills ?? './skills/'
    expect(fs.existsSync(path.join(installed, skills, 'context/SKILL.md')), kind).toBe(true)
  }
  fs.mkdirSync(path.join(repo, '.gatectl'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git('init', '-q', '-b', 'main'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  fs.writeFileSync(path.join(repo, '.gatectl/policy.yaml'), 'version: 1\ntiers: {}\n')
  const env = { ...process.env, GATECTL_STATE_DIR: path.join(dir, 'state') }
  const cli = path.join(installed, 'bin/gatectl.mjs')
  const r = spawnSync(process.execPath, [cli, 'work', 'checkpoint', '--next', 'ship the release', '--target', repo], { env, encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  const hook = spawnSync(process.execPath, [cli, 'hook'], { cwd: repo, env, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: repo, session_id: 's' }) })
  expect(hook.status, hook.stderr).toBe(0)
  expect(JSON.parse(hook.stdout).hookSpecificOutput.additionalContext).toContain('Next: ship the release')
}, 60000)
