// Commit the generated bundle so both marketplace caches are self-contained and work offline.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const plugin = path.join(root, 'plugins/gatectl')
const check = process.argv.includes('--check')
const outputs = new Map()
const bundle = await build({ absWorkingDir: root, entryPoints: ['bin/gatectl.mjs'], bundle: true,
  platform: 'node', target: 'node20', format: 'esm', write: false, legalComments: 'inline',
  define: { GATECTL_BUNDLED: 'true' },
  banner: { js: 'import { createRequire as gatectlCreateRequire } from "node:module";\nconst require = gatectlCreateRequire(import.meta.url);' } })
outputs.set('bin/gatectl.mjs', bundle.outputFiles[0].text)
outputs.set('package.json', JSON.stringify({ name: 'gatectl-plugin-runtime', version: pkg.version, type: 'module', private: true, engines: pkg.engines }, null, 2) + '\n')
outputs.set('LICENSE', fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'))
function copyTemplates(dir, rel = 'templates') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTemplates(path.join(dir, entry.name), `${rel}/${entry.name}`)
    else outputs.set(`${rel}/${entry.name}`, fs.readFileSync(path.join(dir, entry.name), 'utf8'))
  }
}
copyTemplates(path.join(root, 'templates'))
let stale = false
for (const [rel, text] of outputs) {
  const file = path.join(plugin, rel)
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error(`stale plugin artifact: ${rel}`); stale = true }
  } else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
}
for (const kind of ['codex', 'claude']) {
  const file = path.join(plugin, `.${kind}-plugin/plugin.json`)
  if (JSON.parse(fs.readFileSync(file, 'utf8')).version !== pkg.version) { console.error(`${kind} manifest version differs from CLI`); stale = true }
}
if (stale) process.exit(1)
console.log(`gatectl ${pkg.version}: ${outputs.size} plugin runtime files ${check ? 'verified' : 'built'}`)
