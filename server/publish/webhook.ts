import type { NewEvent } from './store'

// The webhook's front door (ARCHITECTURE.md §10.2 step 1): verify Contentful's request
// signature over the raw body and exact path, then read the event out of the payload.

// ---------------------------------------------------------------------------
// Signature

export interface SignedRequest {
  method: string
  /** The path and query exactly as requested, e.g. /api/hooks/content */
  path: string
  headers: Record<string, string | undefined>
  /** The raw body, before any JSON parsing. */
  body: string
}

export type Verification = { ok: true } | { ok: false, reason: 'missing' | 'expired' | 'mismatch' }

const SIGNATURE = 'x-contentful-signature'
const SIGNED_HEADERS = 'x-contentful-signed-headers'
const TIMESTAMP = 'x-contentful-timestamp'

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')

/** The path as Contentful canonicalizes it: the query escaped as one component, then the whole URI-encoded. */
function canonicalPath(path: string): string {
  const [pathname, search] = path.split('?')
  return encodeURI(search ? `${pathname}?${encodeURIComponent(search)}` : pathname!)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Contentful's request verification: HMAC-SHA256 over method, path, the signed headers
 * (sorted, `name:value` joined by `;`) and the body, joined by newlines. Matches
 * verifyRequest in @contentful/node-apps-toolkit, which the tests check against.
 */
export async function verifySignature(secret: string, request: SignedRequest, now = Date.now(), ttlSeconds = 30): Promise<Verification> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers[key.toLowerCase().trim()] = value.trim()
  }
  const signature = headers[SIGNATURE]
  const timestamp = Number.parseInt(headers[TIMESTAMP] ?? '', 10)
  const signedHeaders = (headers[SIGNED_HEADERS] ?? '').split(',').filter(Boolean)
  if (!signature || !Number.isFinite(timestamp) || !signedHeaders.includes(TIMESTAMP) || !signedHeaders.includes(SIGNED_HEADERS)) {
    return { ok: false, reason: 'missing' }
  }
  if (now - timestamp >= ttlSeconds * 1000) return { ok: false, reason: 'expired' }

  const canonicalHeaders = signedHeaders
    .filter(name => headers[name] !== undefined)
    .sort()
    .map(name => `${name}:${headers[name]}`)
    .join(';')
  const canonical = [request.method.toUpperCase(), canonicalPath(request.path), canonicalHeaders, request.body].join('\n')

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical)))
  return timingSafeEqual(signature.toLowerCase(), expected) ? { ok: true } : { ok: false, reason: 'mismatch' }
}

// ---------------------------------------------------------------------------
// Payload

export type ParsedWebhook =
  | { kind: 'event', event: NewEvent }
  | { kind: 'ignored', reason: string }

/** Topic actions that change what the delivery API serves. */
const ACTIONS: Record<string, NewEvent['kind']> = {
  publish: 'publish',
  unpublish: 'unpublish',
  archive: 'unpublish',
  delete: 'unpublish',
}

/**
 * Reads `X-Contentful-Topic` (ContentManagement.<Entry|Asset>.<action>) and the entity's
 * sys. Events for other environments, entity types or actions are ignored, not errors:
 * the webhook may be configured more broadly than the builder needs.
 */
export function parseWebhook(topic: string | undefined, body: unknown, environment: string): ParsedWebhook {
  const match = /^ContentManagement\.(Entry|Asset)\.([a-z_]+)$/.exec(topic ?? '')
  if (!match) return { kind: 'ignored', reason: `topic ${topic ?? '(none)'}` }
  const [, entityType, action] = match as unknown as [string, 'Entry' | 'Asset', string]
  const kind = ACTIONS[action]
  if (!kind) return { kind: 'ignored', reason: `action ${action}` }

  const sys = (body as { sys?: { id?: unknown, revision?: unknown, environment?: { sys?: { id?: unknown } } } } | null)?.sys
  if (typeof sys?.id !== 'string') return { kind: 'ignored', reason: 'no entity id' }
  const env = sys.environment?.sys?.id
  if (env !== undefined && env !== environment) return { kind: 'ignored', reason: `environment ${String(env)}` }

  // Publish payloads carry the published revision; the revision check waits until the
  // delivery API shows at least that. Other events only need the id.
  const revision = kind === 'publish' && typeof sys.revision === 'number' ? sys.revision : 0
  return { kind: 'event', event: { entityId: sys.id, entityType, kind, revision } }
}
