import { test, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
test('keeps every distributed version aligned', () => {
  const version = read('package.json').version
  expect(version).toBe('0.16.3')
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
