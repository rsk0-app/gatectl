// src/core/detect.mjs — reads a target's toolchain off its own manifests so `gatectl init` writes
// real commands instead of placeholders nobody remembers to fill in.
//
// The rule that shapes everything here: gatectl does not guess. Every value below is concluded from
// a file that exists or a dependency that is declared. What cannot be concluded is left unset,
// so the gate that needs it answers NOT_EVALUATED — loudly — rather than running something
// invented and reporting on it. A wrong command that exits 0 is worse than no command at all.
//
// Pure: no I/O. The caller reads the files and hands them over.
import { matchesAny } from "./tier.mjs"

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
]

// Per-file and related-file invocation differs per runner, and getting it wrong makes gate R
// report a pass for a file it never ran. A runner with no related mode gets none: `test_related`
// is optional, `test_file` is not.
const RUNNERS = {
  vitest: { file: "npx vitest run {file}", related: "npx vitest related --run {files}", case: "npx vitest run {file} -t {selector}" },
  jest: { file: "npx jest {file}", related: "npx jest --findRelatedTests {files}", case: "npx jest {file} -t {selector}" },
  mocha: { file: "npx mocha {file}", case: "npx mocha {file} --grep {selector}" },
  ava: { file: "npx ava {file}", case: "npx ava {file} --match {selector}" },
}

const depsOf = (pkg) => ({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) })

// Two different empties, and conflating them was a real defect: a command nobody filled in means
// "unknown" and the gate must refuse, while a project that genuinely has no build step means
// "none" and the gate should skip. A package.json is a complete declaration — if it exists and
// names no build script, that is proof of absence, not ignorance.
const NONE = "none"

function detectJs({ pkg, files, evidence }) {
  const commands = {}
  const pm = LOCKFILES.find(([f]) => files.includes(f))?.[1] ?? "npm"
  evidence.push(`package manager: ${pm}${pm === "npm" && !files.includes("package-lock.json") ? " (no lockfile found — assuming npm)" : ""}`)

  if (pkg?.scripts?.build) commands.build = `${pm} run build`
  else { commands.build = NONE; evidence.push("package.json declares no build script — build: none (gates skip the step)") }

  const deps = depsOf(pkg)
  if (deps.typescript || files.includes("tsconfig.json")) commands.typecheck = "npx tsc --noEmit"
  else { commands.typecheck = NONE; evidence.push("no typescript and no tsconfig.json — typecheck: none (gates skip the step)") }

  const runner = Object.keys(RUNNERS).find((r) => deps[r])
  if (runner) {
    evidence.push(`test runner: ${runner}`)
    commands.test_all = pkg?.scripts?.test ? `${pm} test` : `npx ${runner}${runner === "vitest" ? " run" : ""}`
    commands.test_file = RUNNERS[runner].file
    // Optional: only acceptance criteria written as `file::"case"` need it, and a runner with
    // no single-case form leaves it unset rather than pretending a whole-file run is the same.
    if (RUNNERS[runner].case) commands.test_case = RUNNERS[runner].case
    if (RUNNERS[runner].related) commands.test_related = RUNNERS[runner].related
    else { commands.test_related = NONE; evidence.push(`${runner} has no related-tests mode — test_related: none (G-fast typechecks only)`) }
  } else {
    // Absence of a runner proves nothing about whether tests exist; they may be run some other
    // way. And gate R drives every required test through test_file — `none` there would mean
    // never confirming RED, so test_file is never declared absent.
    evidence.push("no known test runner in dependencies — test commands left unset (unknown, not absent)")
  }
  return commands
}

export function detectCommands({ manifests, files = [] }) {
  const evidence = []
  const pkg = manifests["package.json"]
  if (pkg) return { commands: detectJs({ pkg, files, evidence }), evidence }

  if (manifests["Cargo.toml"]) {
    evidence.push("Cargo.toml found: rust toolchain")
    // cargo runs tests by target, not by file path, so there is no honest {file} form.
    evidence.push("cargo has no per-file test invocation — test_file left unset")
    return { commands: { build: "cargo build", typecheck: "cargo check", test_all: "cargo test" }, evidence }
  }

  if (manifests["go.mod"]) {
    evidence.push("go.mod found: go toolchain")
    evidence.push("go tests run by package, not by file — test_file left unset")
    return { commands: { build: "go build ./...", typecheck: "go vet ./...", test_all: "go test ./..." }, evidence }
  }

  const py = manifests["pyproject.toml"]
  if (py) {
    evidence.push("pyproject.toml found: python toolchain")
    const commands = {}
    if (/pytest/.test(py)) { commands.test_all = "pytest"; commands.test_file = "pytest {file}"; evidence.push("test runner: pytest") }
    if (/mypy/.test(py)) { commands.typecheck = "mypy ." ; evidence.push("type checker: mypy") }
    return { commands, evidence }
  }

  evidence.push("no known manifest (package.json, Cargo.toml, go.mod, pyproject.toml) — no commands detected")
  return { commands: {}, evidence }
}

/**
 * Reports which shipped tier patterns this repository actually has files for. Reports only —
 * it never edits them, and `renderPolicy` never touches a `paths:` line.
 *
 * Pruning dead patterns was tempting and is wrong. Tier patterns are forward-looking: a repo
 * with no `supabase/migrations/**` today may add one tomorrow, and a pattern deleted at init
 * would not be there to catch it. The migration would land in whatever tier still matched, with
 * less ceremony, and nothing would announce the downgrade. Same argument as auto-assigning
 * sensitivity, one step removed — so the answer is the same: report, let a human decide.
 */
export function auditTierPaths(tiers, files) {
  const populated = [], unmatched = [], emptied = []
  for (const [tier, cfg] of Object.entries(tiers ?? {})) {
    const globs = cfg?.paths ?? []
    let live = 0
    for (const glob of globs) {
      const count = files.filter((f) => matchesAny(f, [glob])).length
      if (count > 0) { populated.push({ tier, glob, count }); live++ }
      else unmatched.push({ tier, glob })
    }
    if (globs.length > 0 && live === 0) emptied.push(tier)
  }
  return { populated, unmatched, emptied }
}

const COMMAND_KEYS = ["typecheck", "build", "test_all", "test_file", "test_case", "test_related"]

/**
 * Rewrites the shipped template in place, line by line, rather than re-serialising it. The
 * template's comments carry the reasoning behind half these settings — a YAML round-trip would
 * silently delete all of it.
 */
export function renderPolicy(templateText, detection) {
  return templateText
    .split("\n")
    .map((line) => {
      const cmd = /^(\s*)#?\s*(\w+): "(.*)"$/.exec(line)
      if (cmd && COMMAND_KEYS.includes(cmd[2])) {
        const value = detection.commands[cmd[2]]
        // Commented out, not deleted: the key stays visible as something to fill in, and the
        // gate that needs it reports NOT_EVALUATED meanwhile.
        if (value === undefined)
          return `${cmd[1]}# ${cmd[2]}: "" # not detected — fill this in; gates needing it answer NOT_EVALUATED`
        // Unquoted, so it reads as the declaration it is rather than as a command literally
        // named "none".
        return value === "none"
          ? `${cmd[1]}${cmd[2]}: none # this project has no such step — gates skip it`
          : `${cmd[1]}${cmd[2]}: "${value}"`
      }
      return line
    })
    .join("\n")
}
