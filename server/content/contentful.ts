import type { DeliveryItem } from './raw'

// Fetching the whole published space from the Content Delivery API (ARCHITECTURE.md §10.2
// step 3.1). Plain fetch, no SDK: the builder needs a few paginated calls and a call count
// for the build log, nothing more. Only the builder and the deploy-time seed call this; the
// live site never calls Contentful per request.

export interface DeliveryConfig {
  space: string
  environment: string
  /** A Content Delivery API token (published content only). */
  accessToken: string
  locale: string
  /** `cdn.contentful.com`; the preview deployment uses `preview.contentful.com`. */
  host?: string
}

export interface SpaceContent {
  entries: DeliveryItem[]
  assets: DeliveryItem[]
  /** Delivery-API calls made, for the build log (the free tier allows 100K a month). */
  calls: number
}

export class DeliveryError extends Error {
  override name = 'DeliveryError'
  constructor(message: string, readonly status: number) {
    super(message)
  }

  /** Worth retrying later: rate limits and server errors. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

/** The API's maximum page size. */
const PAGE_SIZE = 1000

type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

export async function fetchSpace(config: DeliveryConfig, fetchFn: Fetch = fetch): Promise<SpaceContent> {
  let calls = 0
  const all = async (path: 'entries' | 'assets'): Promise<DeliveryItem[]> => {
    const items: DeliveryItem[] = []
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const params = new URLSearchParams({
        locale: config.locale,
        limit: String(PAGE_SIZE),
        skip: String(skip),
        // Links stay links; the adapter resolves them against the snapshot itself.
        ...(path === 'entries' ? { include: '0' } : {}),
        // Stable paging while the space changes underneath.
        order: 'sys.id',
      })
      const url = `https://${config.host ?? 'cdn.contentful.com'}/spaces/${config.space}/environments/${config.environment}/${path}?${params}`
      calls++
      const response = await fetchFn(url, { headers: { Authorization: `Bearer ${config.accessToken}` } })
      if (!response.ok) throw new DeliveryError(`Delivery API ${path} returned ${response.status}`, response.status)
      const page = (await response.json()) as { items: DeliveryItem[], total: number }
      items.push(...page.items)
      if (skip + PAGE_SIZE >= page.total) return items
    }
  }
  const entries = await all('entries')
  const assets = await all('assets')
  return { entries, assets, calls }
}

/** One recorded webhook event (a row of content_events). */
export interface ContentEvent {
  entityId: string
  kind: 'publish' | 'unpublish'
  revision: number
}

/**
 * Events the fetched content doesn't reflect yet. The delivery API can lag a webhook by
 * seconds; building from stale content would find nothing changed and drop the publish.
 * Events are in the order received; only the latest one per entity counts.
 */
export function unseenEvents(content: SpaceContent, events: readonly ContentEvent[]): ContentEvent[] {
  const revisions = new Map<string, number>()
  for (const item of [...content.entries, ...content.assets]) revisions.set(item.sys.id, item.sys.revision ?? 0)
  const latest = new Map<string, ContentEvent>()
  for (const event of events) latest.set(event.entityId, event)
  return [...latest.values()].filter((event) => {
    const seen = revisions.get(event.entityId)
    return event.kind === 'publish' ? seen === undefined || seen < event.revision : seen !== undefined
  })
}
