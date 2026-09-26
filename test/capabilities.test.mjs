// The capability map answers the owner's question — what is agreed, what did gatectl accept, which
// tests exist, what is proven on the code as it is now — from records gatectl already keeps. Each
// case builds a repository with real signed ledgers and receipts, and checks that the map claims
// no more than those records support.
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import yaml from "js-yaml"
import { execFileSync, spawnSync } from "node:child_process"
import { compileSpec } from "../src/core/spec-compile.mjs"
import { appendEntry } from "../src/core/ledger.mjs"
import { ledgerFile, attestationFile, loadKey } from "../src/core/authority.mjs"
import { signAttestation } from "../src/core/attest.mjs"
import { treeDigest } from "../src/core/target.mjs"

const BIN = path.resolve("bin/gatectl.mjs")
const SRC = path.resolve("src")

const POLICY = (workflow = true) => [
  "version: 1", "unmatched_tier: A",
  "tiers:", "  A:", "    paths: ['**']", "    requires: [Gfull]",
  "commands:", "  typecheck: none", "  build: none", "  test_all: 'true'",
  "  test_file: 'node runner.mjs {file}'", "  test_case: 'node runner.mjs {file} {selector}'",
  "failure_classes:", "  assertion: ['^AssertionError']", "  empty: ['no matching test']",
  ...(workflow ? ["workflow:", "  mode: fast"] : []), "",
].join("\n")

// Passes a case that appears in the file, fails one marked FAIL:<case>, runs nothing for one
// marked EMPTY:<case>. Every execution is counted outside the repository.
const RUNNER = `
import fs from "node:fs"
const [file, selector] = process.argv.slice(2)
fs.appendFileSync(process.env.RUNS_LOG, JSON.stringify([file, selector ?? null]) + "\\n")
const text = fs.readFileSync(file, "utf8")
if (selector && text.includes("FAIL:" + selector)) { console.log("AssertionError: " + selector); process.exit(1) }
if (selector && (text.includes("EMPTY:" + selector) || !text.includes(selector))) { console.log("no matching test"); process.exit(0) }
console.log("1 passed")
`

const specYaml = (id, mvp, criteria, extra = "") => `id: ${id}
state: DRAFT
mvp_ref: ${mvp}
${extra}intent: |
  ${id} intent line
invariants:
  - id: INV-01
    statement: nothing else changes
acceptance_criteria:
${criteria.map(([cid, file, selector]) => `  - id: ${cid}
    statement: ${cid} of ${id}
${file ? `    test:\n      file: ${file}\n      selector: ${selector}\n` : ""}`).join("")}allowed_paths:
  - src/**
rollback:
  strategy: revert
`

function makeRepo({ workflow = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gatectl-cap-")))
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t")
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }
  write(".gatectl/policy.yaml", POLICY(workflow))
  write(".gatectl/MVP.yaml", yaml.dump({
    mvp_done_when: [{ id: "g-login", text: "People can log in" }, { id: "g-billing", text: "People are billed" }, { id: "g-empty", text: "Nobody worked on this" }],
    out_of_scope: [] }))
  write("runner.mjs", RUNNER)
  write("src/app.js", "export const version = 1\n")
  write("test/login.test.mjs", "it('logs in')\n")
  write("test/bill.test.mjs", "it('charges') FAIL:charges\nit('refunds') EMPTY:refunds\n")
  write("docs/specs/f-login/spec.yaml", specYaml("f-login", "g-login", [["AC-01", "test/login.test.mjs", "logs in"], ["AC-02", "test/login.test.mjs", "a case nobody wrote"]]))
  write("docs/specs/f-bill/spec.yaml", specYaml("f-bill", "g-billing", [["AC-01", "test/bill.test.mjs", "charges"], ["AC-02", "test/bill.test.mjs", "refunds"]]))
  write("docs/specs/f-maint/spec.yaml", specYaml("f-maint", "maintenance", [["AC-01"]], "verification: policy\n"))
  write("docs/specs/f-ghost/spec.yaml", specYaml("f-ghost", "ghost-goal", [["AC-01", "test/login.test.mjs", "logs in"]]))
  write("docs/specs/f-unset/spec.md", "# f-unset\n\nstate: DRAFT\nmvp_ref: REPLACE — an id from .gatectl/MVP.yaml\n\n## Intent\nx\n\n## Acceptance Criteria\n- AC1 x — required: test/login.test.mjs\n")
  write("docs/specs/f-legacy/spec.md", "# f-legacy\n\nstate: DRAFT\nmvp_ref: g-login\n\n## Intent\nlegacy\n\n## Acceptance Criteria\n- AC1 two tests — required: test/login.test.mjs::\"logs in\", test/nowhere.test.mjs\n")
  write("docs/specs/f-broken/spec.yaml", "id: f-broken\n  this: is: not: yaml\n")
  write("docs/specs/f-broken/spec.md", "# f-broken\n\nstate: DRAFT\nmvp_ref: g-login\n\n## Intent\nold\n")
  git("add", "-A"); git("commit", "-qm", "init")
  const state = `${root}-state`
  const runs = `${root}-runs.log`
  fs.writeFileSync(runs, "")
  const env = { ...process.env, GATECTL_STATE_DIR: state, RUNS_LOG: runs }
  const cli = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args, "--target", root], { cwd: root, env, encoding: "utf8" })
    return { code: r.status, out: r.stdout, all: `${r.stdout}${r.stderr}` }
  }
  const map = () => {
    const r = cli(["capabilities", "--json"])
    expect(r.code, r.all).toBe(0)
    return JSON.parse(r.out)
  }
  const feature = (m, slug) => m.groups.flatMap((g) => g.features).find((f) => f.slug === slug)
  const criterion = (m, slug, id) => feature(m, slug).criteria.find((c) => c.id === id)
  const digestOf = (slug) => compileSpec(yaml.load(fs.readFileSync(path.join(root, `docs/specs/${slug}/spec.yaml`), "utf8"))).digest
  const key = () => loadKey(root, { env, create: true }).key
  const complete = (slug, { status = "PASS", digest = digestOf(slug), tree = treeDigest(root), decision = status === "PASS" ? "ACCEPT" : "REJECT", legacy = false } = {}) => {
    const k = key()
    if (legacy) return appendEntry(ledgerFile(root, slug, env), { gate: "Complete", status, digest, tree, at: new Date().toISOString() }, k)
    const completion = signAttestation({ feature: slug, decision, spec_digest: digest, tree, at: new Date().toISOString() }, k)
    const file = path.join(path.dirname(attestationFile(root, slug, env)), "completion.json")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(completion))
    appendEntry(ledgerFile(root, slug, env), { gate: "Complete", status, digest, tree, completion_mac: completion.mac, at: new Date().toISOString() }, k)
  }
  const runsCount = () => fs.readFileSync(runs, "utf8").split("\n").filter(Boolean).length
  return { root, state, env, git, write, cli, map, feature, criterion, digestOf, key, complete, runsCount }
}

describe("capability map", { timeout: 60000 }, () => {
  it("groups features under the owner's goals", () => {
    const r = makeRepo()
    const m = r.map()
    const group = (kind, id) => m.groups.find((g) => g.kind === kind && (id === undefined || g.id === id))
    expect(group("goal", "g-login").features.map((f) => f.slug).sort()).toEqual(["f-legacy", "f-login"])
    expect(group("goal", "g-login").text).toBe("People can log in")
    expect(group("goal", "g-billing").features.map((f) => f.slug)).toEqual(["f-bill"])
    expect(group("goal", "g-empty").features).toEqual([])
    expect(group("goal", "g-empty").note).toContain("no gatectl feature references this goal")
    expect(group("maintenance").features.map((f) => f.slug)).toEqual(["f-maint"])
    expect(group("undeclared", "ghost-goal").features.map((f) => f.slug)).toEqual(["f-ghost"])
    expect(group("unset").features.map((f) => f.slug)).toEqual(["f-unset"])
    const unreadable = group("unreadable").features
    expect(unreadable.map((f) => f.slug)).toEqual(["f-broken"])
    expect(unreadable[0].error).toMatch(/yaml/i)
    const text = r.cli(["capabilities"]).out
    expect(text).toContain("g-login")
    expect(text).toContain("People can log in")
    expect(text).toMatch(/g-empty[\s\S]*no gatectl feature references this goal/)
  })

  it("acceptance is read from the verified ledger", () => {
    const r = makeRepo()
    expect(r.feature(r.map(), "f-login").acceptance.state).toBe("no record here")
    r.complete("f-login")
    r.complete("f-bill", { status: "FAIL" })
    r.complete("f-ghost", { digest: "0".repeat(64) })
    let m = r.map()
    expect(r.feature(m, "f-login").acceptance.state).toBe("accepted")
    expect(r.feature(m, "f-bill").acceptance.state).toBe("rejected")
    expect(r.feature(m, "f-ghost").acceptance.state).toBe("an earlier revision was accepted")
    expect(r.feature(m, "f-login").agreed).toBe("not locked")

    // Unchanged spec, changed and committed code: accepted then, not proven now.
    r.write("src/app.js", "export const version = 2\n")
    r.git("add", "-A"); r.git("commit", "-qm", "change code")
    expect(r.feature(r.map(), "f-login").acceptance.state).toBe("accepted at an earlier tree")

    // A trailing FAIL removed from the ledger: the newer completion record disagrees.
    r.complete("f-maint", { digest: compileSpec(yaml.load(fs.readFileSync(path.join(r.root, "docs/specs/f-maint/spec.yaml"), "utf8"))).digest })
    r.complete("f-maint", { status: "FAIL", digest: compileSpec(yaml.load(fs.readFileSync(path.join(r.root, "docs/specs/f-maint/spec.yaml"), "utf8"))).digest })
    const ledger = ledgerFile(r.root, "f-maint", r.env)
    const lines = fs.readFileSync(ledger, "utf8").trim().split("\n")
    fs.writeFileSync(ledger, lines.slice(0, -1).join("\n") + "\n")
    expect(r.feature(r.map(), "f-maint").acceptance.state).toBe("unreadable")

    // An edited entry breaks the chain.
    const bill = ledgerFile(r.root, "f-bill", r.env)
    fs.writeFileSync(bill, fs.readFileSync(bill, "utf8").replace('"FAIL"', '"PASS"'))
    expect(r.feature(r.map(), "f-bill").acceptance.state).toBe("unreadable")

    // A legacy PASS (no completion link) is shown as not cross-checked; with a later FAIL removed,
    // the REJECT completion record still disagrees with it.
    const legacySpec = "f-legacy-yaml"
    r.write(`docs/specs/${legacySpec}/spec.yaml`, fs.readFileSync(path.join(r.root, "docs/specs/f-ghost/spec.yaml"), "utf8").replace("id: f-ghost", `id: ${legacySpec}`))
    r.complete(legacySpec, { legacy: true, tree: treeDigest(r.root) })
    expect(r.feature(r.map(), legacySpec).acceptance.state).toBe("accepted (not cross-checked)")
    r.complete(legacySpec, { status: "FAIL", tree: treeDigest(r.root) })
    const legacyLedger = ledgerFile(r.root, legacySpec, r.env)
    fs.writeFileSync(legacyLedger, fs.readFileSync(legacyLedger, "utf8").trim().split("\n").slice(0, -1).join("\n") + "\n")
    expect(r.feature(r.map(), legacySpec).acceptance.state).toBe("unreadable")

    // The only Complete there was, removed: the completion record still says a finish happened.
    const lone = "f-lone"
    r.write(`docs/specs/${lone}/spec.yaml`, fs.readFileSync(path.join(r.root, "docs/specs/f-ghost/spec.yaml"), "utf8").replace("id: f-ghost", `id: ${lone}`))
    appendEntry(ledgerFile(r.root, lone, r.env), { gate: "Gfull", status: "PASS", at: new Date().toISOString() }, r.key())
    r.complete(lone, { status: "FAIL", tree: treeDigest(r.root) })
    const loneLedger = ledgerFile(r.root, lone, r.env)
    fs.writeFileSync(loneLedger, fs.readFileSync(loneLedger, "utf8").trim().split("\n").slice(0, -1).join("\n") + "\n")
    expect(r.feature(r.map(), lone).acceptance.state).toBe("unreadable")
    // A ledger line that parses but is not an entry marks this feature unreadable, not the report.
    fs.writeFileSync(loneLedger, "null\n")
    expect(r.feature(r.map(), lone).acceptance.state).toBe("unreadable")

    // A modern PASS whose completion record has gone missing is not accepted.
    fs.rmSync(path.join(path.dirname(attestationFile(r.root, "f-ghost", r.env)), "completion.json"))
    expect(r.feature(r.map(), "f-ghost").acceptance.state).toBe("unreadable")

    // Locked at the current digest.
    fs.writeFileSync(path.join(r.root, "docs/specs/f-login/spec.lock.json"), JSON.stringify([{ version: 1, digest: r.digestOf("f-login") }]))
    expect(r.feature(r.map(), "f-login").agreed).toBe("locked")
  })

  it("reports tests that are missing from the tree", () => {
    const r = makeRepo()
    const m = r.map()
    const missingCase = r.criterion(m, "f-login", "AC-02")
    expect(missingCase.obligations).toEqual([expect.objectContaining({ file: "test/login.test.mjs", selector: "a case nobody wrote", present: false })])
    expect(missingCase.result).toBe("missing")
    const legacy = r.feature(m, "f-legacy").criteria[0]
    expect(legacy.obligations.map((o) => [o.file, o.present])).toEqual([["test/login.test.mjs", true], ["test/nowhere.test.mjs", false]])
    expect(legacy.result).toBe("missing")
    expect(r.criterion(m, "f-maint", "AC-01").result).toBe("no test declared")
    const text = r.cli(["capabilities"]).out
    expect(text).toContain('AC-02: test/login.test.mjs::"a case nobody wrote" — not present in the tree')
    expect(text).toContain("AC1: test/nowhere.test.mjs — not present in the tree")
  })

  it("results are proven for this exact version or not claimed", () => {
    const r = makeRepo()
    const stateFiles = () => fs.existsSync(r.state) ? fs.readdirSync(r.state, { recursive: true }).sort() : []
    r.key()
    const before = stateFiles()
    let m = r.map()
    expect(stateFiles()).toEqual(before)
    expect(r.criterion(m, "f-login", "AC-01").result).toBe("not run on this version")

    expect(r.cli(["capabilities", "--run"]).code).toBe(0)
    m = r.map()
    expect(r.criterion(m, "f-login", "AC-01").result).toBe("pass")
    expect(r.criterion(m, "f-bill", "AC-01").result).toBe("fail")
    expect(r.criterion(m, "f-bill", "AC-02").result).toBe("no test ran")

    // A second run re-executes what did not pass, and reuses what did.
    const refunds = () => fs.readFileSync(`${r.root}-runs.log`, "utf8").split("\n").filter((l) => l.includes("refunds")).length
    const logsIn = () => fs.readFileSync(`${r.root}-runs.log`, "utf8").split("\n").filter((l) => l.includes("logs in")).length
    const [refundsBefore, logsInBefore] = [refunds(), logsIn()]
    r.cli(["capabilities", "--run"])
    expect(refunds()).toBe(refundsBefore + 1)
    expect(logsIn()).toBe(logsInBefore)

    r.write("src/app.js", "export const version = 3\n")
    r.git("add", "-A"); r.git("commit", "-qm", "new code")
    expect(r.criterion(r.map(), "f-login", "AC-01").result).toBe("not run on this version")

    // Staged one thing, working tree another: nothing current is claimed, and --run refuses.
    r.cli(["capabilities", "--run"])
    r.write("src/app.js", "export const version = 4\n"); r.git("add", "-A")
    r.write("src/app.js", "export const version = 5\n")
    expect(r.criterion(r.map(), "f-login", "AC-01").result).toBe("index differs from working tree")
    const drift = r.cli(["capabilities", "--run"])
    expect(drift.code).toBe(2)
    expect(drift.all).toMatch(/index|working tree/i)

    const off = makeRepo({ workflow: false })
    off.key()
    expect(off.criterion(off.map(), "f-login", "AC-01").result).toBe("receipts disabled")
    expect(off.cli(["capabilities", "--run"]).code).toBe(2)

    const nokey = makeRepo()
    const refused = nokey.cli(["capabilities", "--run"])
    expect(refused.code).toBe(2)
    expect(refused.all).toMatch(/key/i)
    expect(fs.existsSync(nokey.state) ? fs.readdirSync(nokey.state, { recursive: true }).filter((f) => f.endsWith(".key")) : []).toEqual([])
  })

  it("gates never read the capability map", () => {
    const importsOf = (file) => [...fs.readFileSync(file, "utf8").matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm)]
      .map((m) => m[1]).filter((s) => s.startsWith(".")).map((s) => path.resolve(path.dirname(file), s))
    const reachable = (entry, seen = new Set()) => {
      if (seen.has(entry)) return seen
      seen.add(entry)
      for (const dep of importsOf(entry)) if (fs.existsSync(dep)) reachable(dep, seen)
      return seen
    }
    expect(fs.existsSync(path.join(SRC, "context/capabilities.mjs"))).toBe(true)
    for (const entry of ["core/gates.mjs", "core/next.mjs", "core/completion.mjs", "core/attest.mjs"]) {
      const bad = [...reachable(path.join(SRC, entry))].filter((f) => f.startsWith(path.join(SRC, "context")))
      expect(bad, entry).toEqual([])
    }
  })
})
