// src/adapters/memory-tdam.mjs — the only file that talks to TencentDB Agent Memory.
//
// It is an adapter, never a gate input: `rda export` calls it on the operator's explicit
// instruction, and `rda critique` calls it for advice it can do without. Nothing under
// src/core/ may import this file (test/memory-boundary.test.mjs enforces that), because a
// gate whose answer depends on a network service is no longer a deterministic function of
// files on disk — which is the whole of gatectl's claim.
//
// Upstream is MemoryKnowledge (TencentCloud/TencentDB-Agent-Memory). Every endpoint is a POST
// carrying an ApiResponseEnvelope: `code: 0` means success, and a non-zero `code` is a
// business error *under HTTP 200* — so the HTTP status alone never proves anything.

const DEFAULT_ENDPOINT = "http://localhost:8421/v3"
const EXPORT_TIMEOUT_MS = 30_000
// A critic that stalls on an unreachable memory host is worse than a critic with no memory.
const READ_TIMEOUT_MS = 5_000
// The service caps a page batch at 20; exceeding it is rejected, not truncated.
const PAGE_BATCH_MAX = 20

/**
 * Secrets are environment-only, deliberately. `.gatectl/policy.yaml` lives inside the target
 * repository and gets committed; a credential placed there is a credential published. A key
 * written into policy anyway is ignored rather than honoured.
 */
export function resolveMemoryConfig({ policy, env = {}, repoName }) {
  const mem = policy?.memory
  if (!mem) return { ok: false, code: "NO_MEMORY_CONFIG", detail: "policy has no memory block — add memory.endpoint and memory.team_id to .gatectl/policy.yaml" }
  if (!mem.team_id) return { ok: false, code: "NO_MEMORY_CONFIG", detail: "policy.memory has no team_id" }

  const missing = ["TDAM_API_KEY", "TDAM_SERVICE_ID"].filter((v) => !env[v]?.trim())
  if (missing.length > 0)
    return { ok: false, code: "NO_CREDENTIALS", detail: `missing environment variable(s): ${missing.join(", ")} — credentials are never read from policy, which is committed` }

  return {
    ok: true,
    config: {
      endpoint: (mem.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, ""),
      teamId: mem.team_id,
      wikiName: mem.wiki_name ?? repoName,
      apiKey: env.TDAM_API_KEY,
      serviceId: env.TDAM_SERVICE_ID,
    },
  }
}

async function post({ config, fetchImpl, path, body, timeoutMs }) {
  let response
  try {
    response = await fetchImpl(`${config.endpoint}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "x-tdai-service-id": config.serviceId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    // Node's fetch collapses every transport failure into "fetch failed" and puts the real
    // reason on `cause`. Reported bare, it cannot distinguish a stopped container from a
    // mistyped endpoint — so the URL and the cause both go into the message.
    // A refused connection to localhost arrives as an AggregateError whose own message is the
    // empty string (one entry per address family), so message alone silently reports nothing.
    const c = e.cause
    const reason = c?.message || c?.code || c?.errors?.[0]?.message || ""
    return { ok: false, detail: `${config.endpoint}${path}: ${e.message}${reason ? ` (${reason})` : ""}` }
  }
  if (!response.ok) return { ok: false, detail: `${path}: HTTP ${response.status}` }

  let envelope
  try { envelope = await response.json() } catch (e) { return { ok: false, detail: `${path}: unreadable response (${e.message})` } }
  if (envelope?.code !== 0)
    return { ok: false, detail: `${path}: code ${envelope?.code} — ${envelope?.message ?? "no message"}` }
  return { ok: true, data: envelope.data ?? {} }
}

/** Idempotent upstream on (service_id, team_id, name): a repeat returns the existing wiki. */
async function ensureWiki({ config, fetchImpl, timeoutMs }) {
  const r = await post({ config, fetchImpl, path: "/wiki/create", timeoutMs,
                         body: { team_id: config.teamId, name: config.wikiName } })
  if (!r.ok) return r
  const wikiId = r.data.wiki_id
  if (!wikiId) return { ok: false, detail: "/wiki/create: response carried no wiki_id" }
  return { ok: true, wikiId }
}

/**
 * Writes a batch of pages in one call. `/wiki/page/write` is atomic across the batch and
 * auto-injects `locked:true`, so the LLM ingest pipeline never rewrites what we sent — the
 * reason a deterministic tool can defend publishing here. A feature's page and the updated
 * index page therefore land together or not at all.
 */
export async function exportPages({ config, fetchImpl, pages }) {
  if (pages.length > PAGE_BATCH_MAX)
    return { ok: false, detail: `batch of ${pages.length} exceeds the service limit of ${PAGE_BATCH_MAX}` }
  const wiki = await ensureWiki({ config, fetchImpl, timeoutMs: EXPORT_TIMEOUT_MS })
  if (!wiki.ok) return wiki
  const r = await post({ config, fetchImpl, path: "/wiki/page/write", timeoutMs: EXPORT_TIMEOUT_MS,
                         body: { team_id: config.teamId, wiki_id: wiki.wikiId, pages } })
  return r.ok ? { ok: true, wikiId: wiki.wikiId, refs: pages.map((p) => p.ref) } : r
}

/**
 * The read path, and the only one that works on a wiki gatectl has merely written to.
 * `/wiki/search` and `/wiki/page/ls` both answer empty until an LLM ingest run moves the wiki
 * to `ready`; `/wiki/page/read` carries no such gate and reads from disk by ref.
 *
 * Swallows everything by design: this only enriches a critic prompt, so a memory outage must
 * not be able to change what any gate answers. Every failure degrades to "no prior context"
 * and the run continues exactly as it does with no memory configured at all.
 */
export async function readPages({ config, fetchImpl, refs }) {
  if (refs.length === 0) return []
  const wiki = await ensureWiki({ config, fetchImpl, timeoutMs: READ_TIMEOUT_MS })
  if (!wiki.ok) return []
  const r = await post({ config, fetchImpl, path: "/wiki/page/read", timeoutMs: READ_TIMEOUT_MS,
                         body: { team_id: config.teamId, wiki_id: wiki.wikiId, refs: refs.slice(0, PAGE_BATCH_MAX) } })
  if (!r.ok || !Array.isArray(r.data.items)) return []
  // A ref that does not exist comes back flagged rather than as an error, so filter here.
  return r.data.items.filter((i) => !i.not_found && typeof i.content === "string")
}

