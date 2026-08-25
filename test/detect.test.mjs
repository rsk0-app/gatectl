import { describe, it, expect } from "vitest"
import { detectCommands, auditTierPaths, renderPolicy } from "../src/core/detect.mjs"
import fs from "node:fs"

const TEMPLATE = fs.readFileSync(new URL("../templates/policy.yaml", import.meta.url), "utf8")

const pkg = (extra = {}) => ({ "package.json": { scripts: { build: "next build" }, devDependencies: { typescript: "^5", vitest: "^4" }, ...extra } })

describe("detectCommands — javascript", () => {
  it("reads the runner and the package manager off disk rather than guessing", () => {
    const d = detectCommands({ manifests: pkg(), files: ["package.json", "pnpm-lock.yaml", "tsconfig.json"] })
    expect(d.commands.build).toBe("pnpm run build")
    expect(d.commands.typecheck).toBe("npx tsc --noEmit")
    expect(d.commands.test_file).toBe("npx vitest run {file}")
    expect(d.commands.test_related).toBe("npx vitest related --run {files}")
  })

  it("picks npm when only a package-lock is present", () => {
    const d = detectCommands({ manifests: pkg(), files: ["package.json", "package-lock.json"] })
    expect(d.commands.build).toBe("npm run build")
  })

  it("picks yarn and bun from their lockfiles", () => {
    expect(detectCommands({ manifests: pkg(), files: ["yarn.lock"] }).commands.build).toBe("yarn run build")
    expect(detectCommands({ manifests: pkg(), files: ["bun.lockb"] }).commands.build).toBe("bun run build")
  })

  it("uses jest's own per-file and related syntax when jest is the runner", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { jest: "^29" } } }, files: ["package.json"] })
    expect(d.commands.test_file).toBe("npx jest {file}")
    expect(d.commands.test_related).toBe("npx jest --findRelatedTests {files}")
  })

  it("declares test_related absent for a runner that has no such mode, rather than inventing one", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { mocha: "^10" } } }, files: ["package.json"] })
    expect(d.commands.test_file).toBe("npx mocha {file}")
    expect(d.commands.test_related).toBe("none")
  })

  it("declares build absent when the project declares no build script", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { vitest: "^4" } } }, files: ["package.json"] })
    expect(d.commands.build).toBe("none")
  })

  it("declares typecheck absent without typescript — a declaration beats an invented command", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { vitest: "^4" } } }, files: ["package.json"] })
    expect(d.commands.typecheck).toBe("none")
  })

  it("finds a runner listed as a regular dependency too", () => {
    const d = detectCommands({ manifests: { "package.json": { dependencies: { vitest: "^4" } } }, files: [] })
    expect(d.commands.test_file).toBe("npx vitest run {file}")
  })

  it("says what each command was concluded from", () => {
    const d = detectCommands({ manifests: pkg(), files: ["pnpm-lock.yaml"] })
    expect(d.evidence.join(" ")).toMatch(/pnpm/)
    expect(d.evidence.join(" ")).toMatch(/vitest/)
  })
})

describe("detectCommands — other toolchains", () => {
  it("detects cargo, and leaves test_file unset because cargo has no per-file run", () => {
    const d = detectCommands({ manifests: { "Cargo.toml": "[package]\nname='x'" }, files: ["Cargo.toml"] })
    expect(d.commands.build).toBe("cargo build")
    expect(d.commands.typecheck).toBe("cargo check")
    expect(d.commands.test_all).toBe("cargo test")
    expect(d.commands.test_file).toBeUndefined()
  })

  it("detects go", () => {
    const d = detectCommands({ manifests: { "go.mod": "module x" }, files: ["go.mod"] })
    expect(d.commands.build).toBe("go build ./...")
    expect(d.commands.test_all).toBe("go test ./...")
  })

  it("detects pytest and mypy independently", () => {
    const d = detectCommands({
      manifests: { "pyproject.toml": "[project]\ndependencies=['pytest','mypy']" }, files: ["pyproject.toml"] })
    expect(d.commands.test_file).toBe("pytest {file}")
    expect(d.commands.typecheck).toBe("mypy .")
  })

  it("returns no commands at all for a repository it cannot read", () => {
    const d = detectCommands({ manifests: {}, files: ["README.md"] })
    expect(d.commands).toEqual({})
    expect(d.evidence.join(" ")).toMatch(/no known/i)
  })
})

describe("auditTierPaths", () => {
  const TIERS = {
    A: { paths: ["supabase/migrations/**", "src/app/api/**", "middleware.ts"] },
    B: { paths: ["src/**"] },
    C: { paths: ["nothing/**"] },
  }
  const FILES = ["src/app/api/route.ts", "src/lib/x.ts", "docs/a.md"]

  it("reports what each pattern matched, so a human can confirm the tier", () => {
    const r = auditTierPaths(TIERS, FILES)
    expect(r.populated).toEqual(expect.arrayContaining([{ tier: "A", glob: "src/app/api/**", count: 1 }]))
  })

  it("reports patterns matching nothing without touching them", () => {
    const r = auditTierPaths(TIERS, FILES)
    expect(r.unmatched.map((u) => u.glob)).toEqual(expect.arrayContaining(["supabase/migrations/**", "middleware.ts"]))
  })

  it("names a tier no pattern of which matches anything here", () => {
    expect(auditTierPaths(TIERS, FILES).emptied).toEqual(["C"])
  })

  // Deleting a dead pattern is a silent downgrade deferred into the future: add supabase later
  // and its migrations land in a lower tier, with nothing announcing it. The audit therefore
  // returns findings only — renderPolicy never rewrites a paths: line.
  it("returns no rewritten patterns at all — it is a report, not an edit", () => {
    expect(auditTierPaths(TIERS, FILES).kept).toBeUndefined()
  })
})

describe("renderPolicy", () => {
  const DETECTION = {
    commands: { build: "pnpm run build", typecheck: "npx tsc --noEmit", test_all: "pnpm test",
                test_file: "npx vitest run {file}", test_related: "npx vitest related --run {files}" },
    evidence: [],
  }

  it("writes the detected commands into the template", () => {
    const out = renderPolicy(TEMPLATE, DETECTION)
    expect(out).toContain('build: "pnpm run build"')
    expect(out).toContain('test_all: "pnpm test"')
  })

  it("comments out a command it could not detect, so the gate answers 2 instead of guessing", () => {
    const out = renderPolicy(TEMPLATE, { commands: { test_file: "npx vitest run {file}" }, evidence: [] })
    expect(out).toMatch(/#\s*build:/)
    expect(out).toContain('test_file: "npx vitest run {file}"')
  })

  it("leaves every tier's paths exactly as shipped", () => {
    const out = renderPolicy(TEMPLATE, DETECTION)
    expect(out).toContain("supabase/migrations/**")
    expect(out).toContain('"src/**"')
  })

  it("leaves the rest of the template — comments included — byte-identical", () => {
    const out = renderPolicy(TEMPLATE, DETECTION)
    for (const line of ["unmatched_tier: A", "requires: [L, R, Gfull, X]", "meta_class:"])
      expect(out).toContain(line)
    expect(out).toContain("# templates/policy.yaml")
    expect(out).toContain("Meta-class: agents never edit this file")
  })

  it("still parses as the same shape of policy", async () => {
    const yaml = (await import("js-yaml")).default
    const p = yaml.load(renderPolicy(TEMPLATE, DETECTION))
    expect(p.version).toBe(1)
    expect(p.tiers.A.requires).toEqual(["L", "R", "Gfull", "X"])
    expect(p.commands.build).toBe("pnpm run build")
    expect(p.commands.test_file).toBe("npx vitest run {file}")
  })
})

// The distinction the dogfood run exposed: a package.json is a complete declaration. If it
// exists and names no build script, that is proof there is no build step — not ignorance. Proof
// of absence becomes `none` (the gate skips); ignorance stays unset (the gate refuses).
describe("detectCommands — proven absence versus ignorance", () => {
  it("declares build none when a manifest exists and names no build script", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { vitest: "^4" } } }, files: ["package.json"] })
    expect(d.commands.build).toBe("none")
  })

  it("declares typecheck none when there is neither typescript nor a tsconfig", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { vitest: "^4" } } }, files: ["package.json"] })
    expect(d.commands.typecheck).toBe("none")
  })

  it("does not declare typecheck none when a tsconfig is present", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { vitest: "^4" } } }, files: ["package.json", "tsconfig.json"] })
    expect(d.commands.typecheck).toBe("npx tsc --noEmit")
  })

  it("declares test_related none for a runner that genuinely has no related mode", () => {
    const d = detectCommands({
      manifests: { "package.json": { devDependencies: { mocha: "^10" } } }, files: ["package.json"] })
    expect(d.commands.test_related).toBe("none")
  })

  // Absence of a runner proves nothing about whether tests exist — they may be run some other
  // way. And gate R runs each required test through test_file: skipping there would mean never
  // confirming RED at all, so test_file is never `none`.
  it("leaves test commands unset when no runner is declared, rather than calling them none", () => {
    const d = detectCommands({ manifests: { "package.json": { name: "x" } }, files: ["package.json"] })
    expect(d.commands.test_file).toBeUndefined()
    expect(d.commands.test_all).toBeUndefined()
  })

  it("leaves everything unset with no manifest at all — nothing is proven either way", () => {
    const d = detectCommands({ manifests: {}, files: ["README.md"] })
    expect(d.commands).toEqual({})
  })

  it("never declares test_file none for cargo — gate R would stop confirming RED", () => {
    const d = detectCommands({ manifests: { "Cargo.toml": "[package]" }, files: ["Cargo.toml"] })
    expect(d.commands.test_file).toBeUndefined()
  })
})

describe("renderPolicy — none", () => {
  it("writes a declared none unquoted and says it was concluded, not guessed", () => {
    const out = renderPolicy(TEMPLATE, { commands: { build: "none", test_all: "npm test" }, evidence: [] })
    expect(out).toMatch(/^\s*build: none\b/m)
    expect(out).not.toMatch(/^\s*#\s*build:/m)
  })
})

describe("detection — single-case invocation", () => {
  it("writes test_case for a runner that has one", () => {
    const d = detectCommands({ manifests: { "package.json": { devDependencies: { vitest: "^4" } } }, files: [] })
    expect(d.commands.test_case).toBe("npx vitest run {file} -t {selector}")
  })
  it("uses the runner's own flag rather than assuming vitest's", () => {
    const d = detectCommands({ manifests: { "package.json": { devDependencies: { mocha: "^10" } } }, files: [] })
    expect(d.commands.test_case).toBe("npx mocha {file} --grep {selector}")
  })
  it("leaves test_case unset when no runner is declared — unset means unknown, and gate R refuses", () => {
    const d = detectCommands({ manifests: { "package.json": { name: "bare" } }, files: [] })
    expect(d.commands.test_case).toBeUndefined()
  })
})
