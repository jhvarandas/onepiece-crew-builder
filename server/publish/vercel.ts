import { put } from '@vercel/blob'
import { dangerouslyDeleteByTag } from '@vercel/functions'

// The publish path's Vercel side: raw snapshots in Blob, tag purges on the CDN, and the
// canary that proves a purge landed (ARCHITECTURE.md §10.2 steps 4, 6 and 7).

/**
 * Uploads raw/<R>.json. The name is the content's hash, so overwriting is harmless and makes
 * retries idempotent. Public: the store holds only published content. Reads the
 * BLOB_READ_WRITE_TOKEN environment variable.
 */
export async function putSnapshot(rawHash: string, bytes: Uint8Array): Promise<string> {
  const blob = await put(`raw/${rawHash}.json`, Buffer.from(bytes), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 31_536_000,
  })
  return blob.url
}

/**
 * The purge helpers silently do nothing outside a Vercel request (§2), which would look
 * like success. @vercel/functions looks the request context up under this symbol; check it
 * ourselves so the build log says 'skipped' instead of 'deleted'.
 */
function inVercelRequest(): boolean {
  const context = (globalThis as Record<symbol, { get?: () => { purge?: unknown } } | undefined>)[Symbol.for('@vercel/request-context')]
  return Boolean(context?.get?.()?.purge)
}

/** Deletes, not invalidates: at sandbox traffic the next visitor is usually you (§10.4). */
export async function purgeTag(tag: string): Promise<string> {
  if (!inVercelRequest()) return 'skipped (no Vercel request context)'
  await dangerouslyDeleteByTag(tag)
  return 'deleted'
}

/** Fetches /__canary through the CDN and returns the content hash it was rendered from. */
export function canary(siteUrl: string, fetchFn: typeof fetch = fetch) {
  return async (): Promise<string | null> => {
    // No cache-busting headers: the point is to see what the CDN serves everyone else.
    const response = await fetchFn(new URL('/__canary', siteUrl), { signal: AbortSignal.timeout(3000) })
    return response.headers.get('x-content-hash')
  }
}
