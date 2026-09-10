import { test, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { executionContext } from '../src/core/check-cache.mjs'
import { canonical } from '../src/core/attest.mjs'
import { childEnv } from '../src/core/target.mjs'

// Reference walker copied from src/core/check-cache.mjs at 6527cc3.
function legacy(root, policy, env) {
  const deps = [], seen = new Set()
  function walk(file) {
    if (!fs.existsSync(file)) return
    const real = fs.realpathSync(file)
    if (seen.has(real)) return
    seen.add(real)
    const s = fs.statSync(real)
    deps.push([file, real, s.size, s.mtimeMs, s.ctimeMs, s.mode])
    if (s.isDirectory()) for (const name of fs.readdirSync(real).sort()) walk(path.join(file, name))
  }
  for (const dir of policy.workflow?.dependency_paths ?? ['node_modules', '.venv']) walk(path.resolve(root, dir))
  for (const file of policy.workflow?.input_paths ?? ['.env', '.env.local', '.env.test', '.env.test.local', '.env.production', '.env.production.local']) walk(path.resolve(root, file))
  return crypto.createHash('sha256').update(canonical({ policy, deps, env: childEnv(env, policy.commands?.env_allow ?? []), runtime: process.versions, platform: process.platform, arch: process.arch })).digest('hex')
}

test('avoids per-file realpath while preserving the legacy fingerprint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-walk-'))
  const policy = { workflow: { dependency_paths: ['alias', 'deps', 'missing'], input_paths: ['.env', 'dangling', '.env/invalid'] } }
  const env = { PATH: '/test', TEST_CONTEXT: 'one' }
  try {
    fs.mkdirSync(path.join(root, 'deps/deep'), { recursive: true })
    for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(root, 'deps/deep', `${i}.js`), 'one')
    for (let i = 0; i < 200; i++) {
      fs.mkdirSync(path.join(root, 'deps', `dir${i}`))
      fs.writeFileSync(path.join(root, 'deps', `dir${i}`, 'entry.js'), 'entry')
    }
    fs.writeFileSync(path.join(root, '.env'), 'input')
    fs.symlinkSync('deps', path.join(root, 'alias'))
    fs.symlinkSync('../', path.join(root, 'deps/deep/cycle'))
    fs.symlinkSync('missing', path.join(root, 'dangling'))
    fs.symlinkSync('missing', path.join(root, 'deps/deep/dangling'))
    fs.symlinkSync('0.js', path.join(root, 'deps/deep/file-alias'))
    fs.symlinkSync(root, path.join(root, 'root-alias'))
    const aliasedRoot = path.join(root, 'root-alias')
    const expected = legacy(aliasedRoot, policy, env)
    const nativeSpy = vi.spyOn(fs.realpathSync, 'native')
    const spy = vi.spyOn(fs, 'realpathSync')
    let actual, calls
    try { actual = executionContext(aliasedRoot, policy, env); calls = spy.mock.calls.length + nativeSpy.mock.calls.length } finally { spy.mockRestore(); nativeSpy.mockRestore() }
    expect(actual).toBe(expected)
    expect(calls).toBe(5) // Three existing configured roots plus cycle and file alias.
    const beforeMutation = executionContext(root, policy, env)
    fs.writeFileSync(path.join(root, 'deps/deep/0.js'), 'changed content')
    expect(executionContext(root, policy, env)).toBe(legacy(root, policy, env))
    expect(executionContext(root, policy, env)).not.toBe(beforeMutation)
    expect(executionContext(root, { workflow: {} }, env)).toBe(legacy(root, { workflow: {} }, env))
    const beforeInput = executionContext(root, policy, env)
    fs.writeFileSync(path.join(root, '.env'), 'changed input')
    expect(executionContext(root, policy, env)).not.toBe(beforeInput)
    expect(executionContext(root, policy, env)).toBe(legacy(root, policy, env))
    if (process.getuid?.() !== 0 && process.platform !== 'win32') {
      const restricted = path.join(root, 'deps/restricted')
      fs.mkdirSync(restricted)
      fs.writeFileSync(path.join(restricted, 'entry'), 'inaccessible')
      try {
        fs.chmodSync(restricted, 0o644)
        expect(executionContext(root, policy, env)).toBe(legacy(root, policy, env))
      } finally { fs.chmodSync(restricted, 0o755) }
    }
    expect(executionContext(root, policy, { ...env, TEST_CONTEXT: 'two' })).not.toBe(executionContext(root, policy, env))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
