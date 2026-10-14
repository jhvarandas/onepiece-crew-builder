import type { BuildRecord, NewEvent, PendingEvent, Pointer, PublishStore, ReleaseResult, SnapshotIndex } from './store'

// PublishStore over Supabase's HTTPS API (PostgREST RPC). Plain fetch, no client library:
// every call is one POST to /rest/v1/rpc/<function>. Direct Postgres connections are
// IPv6-only, so serverless functions go through this API (ARCHITECTURE.md §2).

export interface SupabaseConfig {
  /** https://<project>.supabase.co */
  url: string
  /** A secret key (sb_secret_…). Server-only; it maps to the service_role grants. */
  secretKey: string
  /** Per call. The read path uses 300 ms (§10.3); the builder can afford more. */
  timeoutMs?: number
}

type Fetch = (url: string, init: { method: string, headers: Record<string, string>, body: string, signal?: AbortSignal }) =>
  Promise<Pick<Response, 'ok' | 'status' | 'text'>>

export class StoreError extends Error {
  override name = 'StoreError'
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function supabaseStore(config: SupabaseConfig, fetchFn: Fetch = fetch): PublishStore {
  const base = `${config.url.replace(/\/$/, '')}/rest/v1/rpc`

  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetchFn(`${base}/${fn}`, {
      method: 'POST',
      headers: { 'apikey': config.secretKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
    })
    const text = await response.text()
    if (!response.ok) throw new StoreError(`${fn} failed with ${response.status}: ${text.slice(0, 500)}`, response.status)
    // Functions returning void answer with an empty body.
    return (text ? JSON.parse(text) : null) as T
  }

  return {
    recordEvent: (e: NewEvent) =>
      rpc<number>('record_event', { p_entity_id: e.entityId, p_entity_type: e.entityType, p_kind: e.kind, p_revision: e.revision }),

    acquireLease: (holder, ttlSeconds) => rpc<number | null>('acquire_lease', { p_holder: holder, p_ttl_seconds: ttlSeconds }),

    renewLease: (generation, ttlSeconds) => rpc<boolean>('renew_lease', { p_generation: generation, p_ttl_seconds: ttlSeconds }),

    releaseLease: (generation, force = false) => rpc<ReleaseResult>('release_lease', { p_generation: generation, p_force: force }),

    pendingEvents: async () => {
      const rows = await rpc<{ id: number, entity_id: string, kind: PendingEvent['kind'], revision: number }[]>('pending_events')
      return rows.map(r => ({ id: r.id, entityId: r.entity_id, kind: r.kind, revision: r.revision }))
    },

    markProcessed: ids => rpc<number>('mark_events_processed', { p_ids: ids }),

    snapshotUrl: rawHash => rpc<string | null>('snapshot_url', { p_raw_hash: rawHash }),

    indexSnapshot: async (s: SnapshotIndex) => {
      await rpc('index_snapshot', { p_raw_hash: s.rawHash, p_catalog_hash: s.catalogHash, p_pages_hash: s.pagesHash, p_bytes: s.bytes, p_blob_url: s.blobUrl })
    },

    promote: (rawHash, generation) => rpc<boolean>('promote', { p_raw_hash: rawHash, p_generation: generation }),

    currentPointer: async (): Promise<Pointer | null> => {
      const rows = await rpc<{ raw_hash: string, catalog_hash: string, pages_hash: string, blob_url: string, promoted_by_generation: number, promoted_at: string }[]>('current_pointer')
      const row = rows[0]
      return row
        ? { rawHash: row.raw_hash, catalogHash: row.catalog_hash, pagesHash: row.pages_hash, blobUrl: row.blob_url, generation: row.promoted_by_generation, promotedAt: row.promoted_at }
        : null
    },

    recordBuild: (build: BuildRecord) => rpc<number>('record_build', { p_build: build }),
  }
}
