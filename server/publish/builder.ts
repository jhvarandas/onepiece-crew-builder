import type { Problem } from '#shared/engine'
import { DeliveryError, unseenEvents } from '../content/contentful'
import type { SpaceContent } from '../content/contentful'
import type { DeriveOptions } from '../content/derive'
import { buildSnapshot } from '../content/snapshot'
import type { BuildRecord, PublishStore } from './store'

// The publish path (ARCHITECTURE.md §10.2), run synchronously inside the webhook request:
// take the lease or report busy; fetch, hash and validate the whole space; upload, promote
// (fenced), wait out in-flight renders, purge, check the canary; release the lease, or loop
// when events arrived meanwhile. Every side effect is a dependency, so tests run it with fakes.

export interface PublishDeps {
  store: PublishStore
  /** The whole published space from the delivery API. Throws DeliveryError. */
  fetchContent: () => Promise<SpaceContent>
  locale: string
  /** Uploads raw/<rawHash>.json, idempotently, and returns its URL. */
  putSnapshot: (rawHash: string, bytes: Uint8Array) => Promise<string>
  /** Deletes a CDN cache tag. Returns what happened ('deleted', or 'skipped' outside Vercel); throws on failure. */
  purgeTag: (tag: string) => Promise<string>
  /** The x-content-hash the CDN serves for /__canary, or null when there's no canary yet. */
  canary: (() => Promise<string | null>) | null
  clock: { now: () => number, sleep: (ms: number) => Promise<void> }
  derive?: DeriveOptions
}

export interface PublishOptions {
  trigger: string
  holder: string
  leaseSeconds?: number
  /** Contentful waits 30 s for the webhook's response; finish well before. */
  budgetMs?: number
  /** Longer than the longest render (8 s), so no render that read the old pointer lands after the purge. */
  renderWaitMs?: number
  /** Waits between refetches while the delivery API lags the webhook. */
  revisionBackoffMs?: readonly number[]
}

export type PublishOutcome =
  | { status: 'busy' }
  /** `retryable`: the last build failed in a way a later attempt may fix (delivery API down, Blob error). */
  | { status: 'done', builds: BuildRecord[], retryable: boolean }

const DEFAULTS = { leaseSeconds: 60, budgetMs: 20_000, renderWaitMs: 10_000, revisionBackoffMs: [500, 1000, 2000, 4000] }

/** Where all problems in a build record come from, when they aren't content errors. */
const problem = (code: string, error: unknown): Problem =>
  ({ severity: 'error', code, subject: 'publish', message: error instanceof Error ? error.message : String(error) })

export async function publish(deps: PublishDeps, options: PublishOptions): Promise<PublishOutcome> {
  const opts = { ...DEFAULTS, ...options }
  const { store, clock } = deps
  const start = clock.now()
  const generation = await store.acquireLease(opts.holder, opts.leaseSeconds)
  if (generation === null) return { status: 'busy' }

  const builds: BuildRecord[] = []
  try {
    for (let iteration = 0; ; iteration++) {
      if (iteration > 0 && !(await store.renewLease(generation, opts.leaseSeconds))) return { status: 'done', builds, retryable: false }

      const { record, retryable } = await buildOnce(deps, opts, generation, start)
      builds.push(record)
      await store.recordBuild(record)

      // Fenced: a newer builder holds the lease and will handle the events.
      if (record.result === 'fenced') return { status: 'done', builds, retryable: false }
      if (record.result === 'failed') {
        await store.releaseLease(generation, true)
        return { status: 'done', builds, retryable }
      }
      // Events that arrived during this build need another pass. Loop if a full one still
      // fits in the budget; otherwise let go, and the next webhook retry or the cron picks them up.
      const outOfTime = clock.now() - start + opts.renderWaitMs + 5_000 > opts.budgetMs
      const release = await store.releaseLease(generation, outOfTime)
      if (release !== 'pending') return { status: 'done', builds, retryable: false }
    }
  }
  catch (error) {
    // Usually the store itself failing. Free the lease if we can; it expires anyway.
    await store.releaseLease(generation, true).catch(() => {})
    throw error
  }
}

async function buildOnce(deps: PublishDeps, opts: Required<PublishOptions>, generation: number, start: number) {
  const { store, clock } = deps
  const startedAt = clock.now()
  const timings: Record<string, number> = {}
  const time = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
    const t = clock.now()
    try {
      return await work()
    }
    finally {
      timings[step] = (timings[step] ?? 0) + clock.now() - t
    }
  }
  const record: BuildRecord = {
    trigger: opts.trigger, generation, startedAt: new Date(startedAt).toISOString(), result: 'failed',
    rawHash: null, catalogHash: null, pagesHash: null, deliveryCalls: 0, timings, errors: [], warnings: [], purge: null, canary: null,
  }
  const done = (result: BuildRecord['result'], retryable = false) => {
    record.result = result
    timings.total = clock.now() - startedAt
    return { record, retryable }
  }

  // 1. Fetch, until the delivery API shows every recorded event (it can lag the webhook).
  const events = await store.pendingEvents()
  let content: SpaceContent
  let unseen: ReturnType<typeof unseenEvents>
  try {
    content = await time('fetch', deps.fetchContent)
    record.deliveryCalls += content.calls
    unseen = unseenEvents(content, events)
    for (const wait of opts.revisionBackoffMs) {
      if (!unseen.length || clock.now() - start + wait > opts.budgetMs / 2) break
      await time('lag', () => clock.sleep(wait))
      content = await time('fetch', deps.fetchContent)
      record.deliveryCalls += content.calls
      unseen = unseenEvents(content, events)
    }
  }
  catch (error) {
    record.errors.push(problem('delivery', error))
    return done('failed', error instanceof DeliveryError ? error.retryable : true)
  }
  // Events this content reflects. Unseen ones stay pending, so the lease isn't released
  // as if they were handled.
  const unseenIds = new Set(unseen.map(e => e.entityId))
  const reflected = events.filter(e => !unseenIds.has(e.entityId)).map(e => e.id)
  if (unseen.length) record.warnings.push({ ...problem('delivery-lag', `not visible yet: ${[...unseenIds].join(', ')}`), severity: 'warning' })

  // 2–3. Normalize, hash, validate with this deployment's code.
  const built = await time('derive', () => buildSnapshot(content, deps.locale, deps.derive))
  Object.assign(record, { rawHash: built.hashes.raw, catalogHash: built.hashes.catalog, pagesHash: built.hashes.pages })
  record.warnings.push(...built.result.warnings)
  if (!built.result.ok) {
    // A retry won't fix content, so the events count as handled.
    record.errors.push(...built.result.errors)
    await store.markProcessed(reflected)
    return done('rejected')
  }

  const pointer = await store.currentPointer()
  if (pointer?.rawHash === built.hashes.raw) {
    await store.markProcessed(reflected)
    return done('unchanged')
  }

  // 4. Upload (content-addressed, so skipped when already indexed), then index.
  try {
    await time('upload', async () => {
      if (await store.snapshotUrl(built.hashes.raw)) return
      const blobUrl = await deps.putSnapshot(built.hashes.raw, built.bytes)
      const { raw, catalog, pages } = built.hashes
      await store.indexSnapshot({ rawHash: raw, catalogHash: catalog, pagesHash: pages, bytes: built.bytes.byteLength, blobUrl })
    })
  }
  catch (error) {
    record.errors.push(problem('upload', error))
    return done('failed', true)
  }

  // 5. Promote, fenced by the lease generation.
  if (!(await time('promote', () => store.promote(built.hashes.raw, generation)))) return done('fenced')

  // 6. Wait out renders that read the old pointer, then purge (one retry).
  await time('wait', () => clock.sleep(opts.renderWaitMs))
  record.purge = await time('purge', async () => {
    try {
      return await deps.purgeTag('content')
    }
    catch {
      try {
        return `retried: ${await deps.purgeTag('content')}`
      }
      catch (error) {
        return `failed: ${problem('purge', error).message}`
      }
    }
  })

  // 7. The canary proves the purge reached the CDN.
  record.canary = await time('canary', async () => {
    if (!deps.canary) return 'skipped'
    try {
      const served = await deps.canary()
      return served === built.hashes.raw ? 'ok' : `mismatch: ${served ?? 'no hash'}`
    }
    catch (error) {
      return `failed: ${problem('canary', error).message}`
    }
  })

  // 8. The caller releases the lease, or loops.
  await store.markProcessed(reflected)
  return done('promoted')
}
