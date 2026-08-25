// Two jobs, deliberately in one file: prove the README documents the registration call well
// enough to run, and prove the note never quietly becomes an integration.
//
// The second half is the one that matters in a year. A README section is easy to write and easy
// to contradict — someone adds a CodeGraph client to rda "just to check status", the docs still
// read correctly, and the boundary is gone with nothing to notice it. Prose cannot hold a line;
// a failing test can. Same reasoning as test/memory-boundary.test.mjs.
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")

const filesUnder = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? filesUnder(p) : p.endsWith(".mjs") ? [p] : []
  })

describe("README documents the CodeGraph registration", () => {
  it("names the exact endpoint, so the reader is not left to guess it", () => {
    expect(README).toContain("/code-graph/create")
  })

  it("names the required fields — team_id and repo_url — not just the endpoint", () => {
    expect(README).toContain("repo_url")
    expect(README).toContain("team_id")
  })

  it("says credentials come from the environment, never from the committed policy", () => {
    expect(README).toContain("TDAM_API_KEY")
    expect(README).toContain("TDAM_SERVICE_ID")
  })

  // A "one-time" instruction with no idempotency story invites a duplicate registration the
  // first time somebody loses the response and retries.
  it("states the idempotency guarantee that makes a retry safe", () => {
    expect(README.toLowerCase()).toContain("idempotent")
  })

  it("says a human runs it and agents consume the result — not rda", () => {
    const section = README.slice(README.indexOf("/code-graph/create") - 1500,
                                README.indexOf("/code-graph/create") + 1500)
    expect(section.toLowerCase()).toMatch(/human|by hand|once per repo/)
    expect(section.toLowerCase()).toContain("agent")
  })
})

describe("CodeGraph stays out of rda", () => {
  it("no file under src/ references CodeGraph in any form", () => {
    const offenders = filesUnder(path.join(ROOT, "src")).filter((f) =>
      /code-graph|codegraph|code_graph/i.test(fs.readFileSync(f, "utf8")))
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([])
  })
})
