import { describe, it, expect } from "vitest"
import { resolveMemoryConfig, exportPages, readPages } from "../src/adapters/memory-tdam.mjs"

const POLICY = { memory: { endpoint: "http://localhost:8421/v3", team_id: "team-abc", wiki_name: "delivery-record" } }
const ENV = { TDAM_API_KEY: "key-1", TDAM_SERVICE_ID: "svc-1" }
const CONFIG = { endpoint: "http://localhost:8421/v3", teamId: "team-abc", wikiName: "delivery-record",
                 apiKey: "key-1", serviceId: "svc-1" }

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data, message: "ok" }) })
const envelopeErr = (code, message) => ({ ok: true, status: 200, json: async () => ({ code, data: null, message }) })

function recorder(responses) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const next = responses.shift()
    if (typeof next === "function") return next()
    return next
  }
  return { calls, fetchImpl }
}

describe("resolveMemoryConfig", () => {
  it("resolves from policy plus env", () => {
    const r = resolveMemoryConfig({ policy: POLICY, env: ENV, repoName: "target" })
    expect(r.ok).toBe(true)
    expect(r.config).toMatchObject({ teamId: "team-abc", apiKey: "key-1", serviceId: "svc-1" })
  })

  it("defaults wiki_name to the target repo's directory name", () => {
    const policy = { memory: { endpoint: "http://x/v3", team_id: "t" } }
    expect(resolveMemoryConfig({ policy, env: ENV, repoName: "my-app" }).config.wikiName).toBe("my-app")
  })

  it("reports a missing memory block by name", () => {
    const r = resolveMemoryConfig({ policy: {}, env: ENV, repoName: "target" })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("memory")
  })

  it("reports each missing credential by its variable name, never guessing one", () => {
    const r = resolveMemoryConfig({ policy: POLICY, env: { TDAM_SERVICE_ID: "svc-1" }, repoName: "target" })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("TDAM_API_KEY")
  })

  it("reports a memory block with no team_id", () => {
    const policy = { memory: { endpoint: "http://x/v3" } }
    const r = resolveMemoryConfig({ policy, env: ENV, repoName: "target" })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("team_id")
  })

  it("never carries a credential that came from policy — secrets are env-only", () => {
    const policy = { memory: { ...POLICY.memory, api_key: "leaked-from-committed-file" } }
    const r = resolveMemoryConfig({ policy, env: ENV, repoName: "target" })
    expect(r.config.apiKey).toBe("key-1")
  })
})

describe("exportPages", () => {
  it("creates the wiki, then writes the page, sending tenant headers on both", async () => {
    const { calls, fetchImpl } = recorder([ok({ wiki_id: "wiki-9c1f2b" }), ok({ written: 1 })])
    const r = await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(r.ok).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([
      "http://localhost:8421/v3/wiki/create",
      "http://localhost:8421/v3/wiki/page/write",
    ])
    for (const c of calls) {
      expect(c.init.headers.Authorization).toBe("Bearer key-1")
      expect(c.init.headers["x-tdai-service-id"]).toBe("svc-1")
      expect(c.init.method).toBe("POST")
    }
  })

  it("writes the page into the wiki_id that create returned", async () => {
    const { calls, fetchImpl } = recorder([ok({ wiki_id: "wiki-9c1f2b" }), ok({ written: 1 })])
    await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(calls[1].body).toMatchObject({
      team_id: "team-abc", wiki_id: "wiki-9c1f2b",
      pages: [{ ref: "rda/x.md", content: "# x" }],
    })
  })

  it("never puts the api key in a request body", async () => {
    const { calls, fetchImpl } = recorder([ok({ wiki_id: "w" }), ok({})])
    await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    for (const c of calls) expect(JSON.stringify(c.body)).not.toContain("key-1")
  })

  it("surfaces a non-zero envelope code as failure even under HTTP 200", async () => {
    const { fetchImpl } = recorder([envelopeErr(40901, "wiki is processing")])
    const r = await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("40901")
    expect(r.detail).toContain("wiki is processing")
  })

  it("surfaces an HTTP error", async () => {
    const { fetchImpl } = recorder([{ ok: false, status: 401, json: async () => ({}) }])
    const r = await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("401")
  })

  it("catches a transport throw instead of crashing the CLI", async () => {
    const fetchImpl = async () => { throw new Error("ECONNREFUSED") }
    const r = await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("ECONNREFUSED")
  })

  // Node's fetch reports every transport failure as the opaque "fetch failed" and hides the
  // real reason on `cause`. An operator reading only that cannot tell a wrong endpoint from a
  // stopped container, so the endpoint and the cause both have to reach the message.
  it("names the endpoint and the underlying cause, not just 'fetch failed'", async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: new Error("connect ECONNREFUSED 127.0.0.1:8421") })
    }
    const r = await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(r.detail).toContain("http://localhost:8421/v3")
    expect(r.detail).toContain("ECONNREFUSED")
  })

  // The shape a refused localhost connection actually takes in Node: an AggregateError with one
  // entry per address family and an EMPTY own message, so reading `cause.message` reports
  // nothing at all. Found by running the CLI against a stopped server, not by a unit test.
  it("still reports a cause when it is an AggregateError with an empty message", async () => {
    const fetchImpl = async () => {
      const cause = new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:8421")], "")
      cause.code = "ECONNREFUSED"
      throw Object.assign(new TypeError("fetch failed"), { cause })
    }
    const r = await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(r.detail).toContain("ECONNREFUSED")
  })

  it("does not write the page when create fails", async () => {
    const { calls, fetchImpl } = recorder([envelopeErr(500, "boom"), ok({})])
    await exportPages({ config: CONFIG, fetchImpl, pages: [{ ref: "rda/x.md", content: "# x" }] })
    expect(calls).toHaveLength(1)
  })
})

describe("readPages", () => {
  it("reads pages by ref — the only path that works before an ingest run", async () => {
    const { calls, fetchImpl } = recorder([
      ok({ wiki_id: "wiki-9c1f2b" }),
      ok({ items: [{ ref: "rda/auth.md", content: "# auth" }] }),
    ])
    const pages = await readPages({ config: CONFIG, fetchImpl, refs: ["rda/auth.md"] })
    expect(pages).toEqual([{ ref: "rda/auth.md", content: "# auth" }])
    expect(calls[1].url).toBe("http://localhost:8421/v3/wiki/page/read")
    expect(calls[1].body).toMatchObject({ team_id: "team-abc", wiki_id: "wiki-9c1f2b", refs: ["rda/auth.md"] })
  })

  // A missing ref comes back flagged inside a 200, not as an error: an index line whose page was
  // deleted would otherwise reach the critic as an entry with no content.
  it("drops refs the service reports as not found", async () => {
    const { fetchImpl } = recorder([ok({ wiki_id: "w" }), ok({ items: [
      { ref: "rda/gone.md", not_found: true },
      { ref: "rda/here.md", content: "# here" },
    ] })])
    expect(await readPages({ config: CONFIG, fetchImpl, refs: ["rda/gone.md", "rda/here.md"] }))
      .toEqual([{ ref: "rda/here.md", content: "# here" }])
  })

  it("asks nothing of the service for an empty ref list", async () => {
    const { calls, fetchImpl } = recorder([])
    expect(await readPages({ config: CONFIG, fetchImpl, refs: [] })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("returns empty on transport failure — an advisory read must never break the run", async () => {
    const fetchImpl = async () => { throw new Error("ECONNREFUSED") }
    await expect(readPages({ config: CONFIG, fetchImpl, refs: ["rda/a.md"] })).resolves.toEqual([])
  })

  it("returns empty on a non-zero envelope code", async () => {
    const { fetchImpl } = recorder([ok({ wiki_id: "w" }), envelopeErr(404, "wiki not found")])
    await expect(readPages({ config: CONFIG, fetchImpl, refs: ["rda/a.md"] })).resolves.toEqual([])
  })

  it("returns empty rather than throwing when the response carries no items", async () => {
    const { fetchImpl } = recorder([ok({ wiki_id: "w" }), ok({})])
    await expect(readPages({ config: CONFIG, fetchImpl, refs: ["rda/a.md"] })).resolves.toEqual([])
  })
})

// The service rejects a batch over 20 rather than truncating it, so rda must not send one.
describe("exportPages — batch limit", () => {
  it("refuses a batch larger than the service accepts, without calling it", async () => {
    const { calls, fetchImpl } = recorder([])
    const pages = Array.from({ length: 21 }, (_, i) => ({ ref: `rda/${i}.md`, content: "x" }))
    const r = await exportPages({ config: CONFIG, fetchImpl, pages })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("20")
    expect(calls).toHaveLength(0)
  })
})
