import { fetchSpace } from '../../content/contentful'
import { publish } from '../../publish/builder'
import { ConfigError, publishConfig } from '../../publish/config'
import { supabaseStore } from '../../publish/supabase'
import { canary, purgeTag, putSnapshot } from '../../publish/vercel'
import { parseWebhook, verifySignature } from '../../publish/webhook'

// POST /api/hooks/content: Contentful's publish webhook (ARCHITECTURE.md §10.2).
//
// Status codes are chosen for Contentful's retry behaviour (it retries 429 and 5xx twice,
// about 30 s apart, and never retries timeouts):
//   200  built (promoted, unchanged, rejected or fenced) or ignored; a retry wouldn't help
//   401  bad signature;  400  unreadable body
//   503  busy (another build holds the lease) or a retryable failure: let Contentful re-kick

export default defineEventHandler(async (event) => {
  let config
  try {
    config = publishConfig()
  }
  catch (error) {
    if (error instanceof ConfigError) throw createError({ statusCode: 500, statusMessage: error.message })
    throw error
  }

  const body = (await readRawBody(event, 'utf8')) ?? ''
  const verified = await verifySignature(config.contentful.webhookSecret, {
    method: event.method,
    path: event.path,
    headers: getRequestHeaders(event),
    body,
  })
  if (!verified.ok) throw createError({ statusCode: 401, statusMessage: `Signature ${verified.reason}` })

  let payload: unknown
  try {
    payload = JSON.parse(body)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Body is not JSON' })
  }
  const topic = getRequestHeader(event, 'x-contentful-topic')
  const parsed = parseWebhook(topic, payload, config.contentful.environment)
  if (parsed.kind === 'ignored') return { ignored: parsed.reason }

  const store = supabaseStore(config.supabase)
  await store.recordEvent(parsed.event)

  const outcome = await publish({
    store,
    fetchContent: () => fetchSpace(config.contentful),
    locale: config.contentful.locale,
    putSnapshot,
    purgeTag,
    canary: config.siteUrl ? canary(config.siteUrl) : null,
    clock: { now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) },
  }, {
    trigger: `webhook ${topic} ${parsed.event.entityId}`,
    holder: config.holder,
  })

  if (outcome.status === 'busy' || outcome.retryable) {
    setResponseHeader(event, 'Retry-After', 30)
    setResponseStatus(event, 503)
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return outcome.status === 'busy'
    ? { status: 'busy' }
    : { status: 'done', builds: outcome.builds.map(b => ({ result: b.result, rawHash: b.rawHash, errors: b.errors.length, purge: b.purge, canary: b.canary, ms: b.timings.total })) }
})
