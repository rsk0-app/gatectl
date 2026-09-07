// Local execution receipts. A cache hit never stands in for a different command or candidate.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { treeDigest, indexDrift, runCmd, childEnv, commandArgv } from './target.mjs'
import { stateDir, loadKey } from './authority.mjs'
import { canonical, signAttestation, verifySignature } from './attest.mjs'
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex')
export function executionContext(root, policy, env = process.env) {
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
  return hash({ policy, deps, env: childEnv(env, policy.commands?.env_allow ?? []), runtime: process.versions, platform: process.platform, arch: process.arch })
}
export function cachedRunner(root, policy, { fresh = false, execute = runCmd, announce = console.log } = {}) {
  const executed = new Set()
  const enabled = !!policy.workflow && policy.workflow.cache !== false
  return (command, subst = {}) => {
    if (!enabled) return execute(root, command, subst, { allow: policy.commands?.env_allow ?? [] })
    if (indexDrift(root).length) return { code: 2, output: 'Stage the intended candidate before checking: working tree differs from index.' }
    const before = treeDigest(root), context = executionContext(root, policy)
    const argv = commandArgv(command, subst)
    // Include the resolved executable; PATH content may change without PATH itself changing.
    const executable = argv[0].includes('/') ? path.resolve(root, argv[0]) : (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, argv[0])).find(p => fs.existsSync(p))
    const stat = executable && fs.existsSync(executable) ? fs.statSync(executable) : null
    const id = hash({ before, context, argv, executable, executableStat: stat && [stat.size, stat.mtimeMs, stat.ctimeMs] })
    const key = loadKey(root)
    if (!key.ok) throw new Error(key.detail)
    const file = path.join(stateDir(root), 'checks', id + '.json')
    if ((!fresh || executed.has(id)) && fs.existsSync(file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (verifySignature(saved, key.key) && saved.id === id && saved.result.code === 0) {
          announce(`  reused check: ${argv.join(' ')}`)
          return saved.result
        }
      } catch { /* Invalid evidence is a cache miss, never PASS. */ }
    }
    const result = execute(root, command, subst, { allow: policy.commands?.env_allow ?? [] })
    if (indexDrift(root).length || treeDigest(root) !== before || executionContext(root, policy) !== context)
      return { code: 1, output: 'Candidate or execution environment changed during the check; rerun on stable inputs.' }
    // A forced rerun that fails invalidates any earlier receipt for these inputs.
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(signAttestation({ id, result, at: new Date().toISOString() }, key.key)), { mode: 0o600 })
    fs.renameSync(tmp, file)
    executed.add(id)
    return result
  }
}
