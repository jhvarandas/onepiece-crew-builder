import { beforeEach, describe, expect, it } from 'vitest'
import { DeliveryError } from '../../server/content/contentful'
import type { SpaceContent } from '../../server/content/contentful'
import { publish } from '../../server/publish/builder'
import type { PublishDeps } from '../../server/publish/builder'
import { supabaseStore } from '../../server/publish/supabase'
import type { PublishStore } from '../../server/publish/store'
import { ids, spaceFixture, withEntry } from '../fixtures/space'
import { supabaseInMemory } from './postgrest'

// The builder against the real SQL (PGlite) and fakes for everything else: a delivery API
// whose content the test changes, a Blob store, a CDN that records purges, and a virtual clock.

let supabase: Awaited<ReturnType<typeof supabaseInMemory>>
let store: PublishStore
let world: ReturnType<typeof fakeWorld>

function fakeWorld() {
  const log: string[] = []
  let now = Date.parse('2026-10-14T12:00:00Z')
  let space: SpaceContent = spaceFixture()
  let live: string | null = null
  const uploads = new Map<string, Uint8Array>()
  const hooks = { onFetch: [] as (() => Promise<void> | void)[], afterFetch: [] as (() => Promise<void> | void)[], onPurge: [] as (() => Promise<void> | void)[], fetchError: null as Error | null, purgeFailures: 0 }

  const deps: PublishDeps = {
    store: undefined as unknown as PublishStore,
    locale: 'en-US',
    fetchContent: async () => {
      log.push(`fetch @${now}`)
      await hooks.onFetch.shift()?.()
      if (hooks.fetchError) throw hooks.fetchError
      const content = structuredClone(space)
      await hooks.afterFetch.shift()?.()
      return content
    },
    putSnapshot: async (raw, bytes) => {
      log.push(`upload ${raw.slice(0, 8)}`)
      uploads.set(raw, bytes)
      return `https://blob.example/raw/${raw}.json`
    },
    purgeTag: async (tag) => {
      log.push(`purge ${tag} @${now}`)
      await hooks.onPurge.shift()?.()
      if (hooks.purgeFailures-- > 0) throw new Error('purge API 500')
      return 'deleted'
    },
    canary: async () => live,
    clock: { now: () => now, sleep: async (ms) => {
      now += ms
    } },
  }

  return {
    deps,
    log,
    uploads,
    hooks,
    get now() {
      return now
    },
    /** Publishes an entry change: new fields and a higher revision, as the delivery API will show it. */
    edit(id: string, fields: Record<string, unknown>) {
      const next = withEntry(space, id, fields)
      next.entries = next.entries.map(e => (e.sys.id === id ? { ...e, sys: { ...e.sys, revision: (e.sys.revision ?? 1) + 1 } } : e))
      space = next
      return next.entries.find(e => e.sys.id === id)!.sys.revision!
    },
    /** What the CDN serves for /__canary after a purge (the test decides). */
    serveCanary(hash: string | null) {
      live = hash
    },
  }
}

const options = { trigger: 'webhook', holder: 'test' }

beforeEach(async () => {
  supabase = await supabaseInMemory()
  store = supabaseStore({ url: 'https://test.supabase.co', secretKey: 'sb_secret_test' }, supabase.fetchFn)
  world = fakeWorld()
  world.deps.store = store
})

const run = () => publish(world.deps, options)
const builds = async () => supabase.admin('select result, purge, canary, delivery_calls from public.content_builds order by id')
/** Whether another builder could take the lease now (released again right after). */
async function leaseFree() {
  const g = await store.acquireLease('probe', 60)
  if (g !== null) await store.releaseLease(g, true)
  return g !== null
}

describe('publish', () => {
  it('promotes a first snapshot: upload, index, promote, wait, purge, canary, release', async () => {
    await store.recordEvent({ entityId: ids.character('zoro'), entityType: 'Entry', kind: 'publish', revision: 1 })
    world.hooks.onPurge.push(async () => world.serveCanary((await store.currentPointer())!.rawHash))

    const outcome = await run()
    expect(outcome).toMatchObject({ status: 'done', retryable: false, builds: [{ result: 'promoted', purge: 'deleted', canary: 'ok', deliveryCalls: 2 }] })
    const pointer = (await store.currentPointer())!
    expect(world.uploads.has(pointer.rawHash)).toBe(true)
    expect(pointer.blobUrl).toBe(`https://blob.example/raw/${pointer.rawHash}.json`)

    // The purge waits out renders that may have read the old pointer.
    const start = Date.parse('2026-10-14T12:00:00Z')
    expect(world.log).toEqual([`fetch @${start}`, `upload ${pointer.rawHash.slice(0, 8)}`, `purge content @${start + 10_000}`])
    expect(await store.pendingEvents()).toEqual([])
    expect(await leaseFree()).toBe(true)
    expect(await builds()).toEqual([{ result: 'promoted', purge: 'deleted', canary: 'ok', delivery_calls: 2 }])
  })

  it('does nothing visible when the content hashes the same', async () => {
    await run()
    world.log.length = 0
    const outcome = await run()
    expect(outcome).toMatchObject({ builds: [{ result: 'unchanged' }] })
    expect(world.log).toEqual([expect.stringMatching(/^fetch/)])
  })

  it('rejects invalid content: the pointer stays, the events count as handled, no retry', async () => {
    await run()
    const before = await store.currentPointer()
    const revision = world.edit(ids.character('zoro'), { statCombat: 120 })
    await store.recordEvent({ entityId: ids.character('zoro'), entityType: 'Entry', kind: 'publish', revision })

    const outcome = await run()
    expect(outcome).toMatchObject({ retryable: false, builds: [{ result: 'rejected', errors: [{ code: 'stat-range' }] }] })
    expect(await store.currentPointer()).toEqual(before)
    expect(await store.pendingEvents()).toEqual([])
  })

  it('reports busy while another builder holds the lease', async () => {
    await store.acquireLease('other', 60)
    expect(await run()).toEqual({ status: 'busy' })
    expect(world.log).toEqual([])
  })

  it('refetches while the delivery API lags the webhook', async () => {
    await run()
    world.log.length = 0
    // The webhook says revision 2 exists; the delivery API shows it only from the third fetch.
    const event = { entityId: ids.character('zoro'), entityType: 'Entry' as const, kind: 'publish' as const, revision: 2 }
    await store.recordEvent(event)
    world.hooks.onFetch.push(() => {}, () => {}, () => {
      world.edit(ids.character('zoro'), { statCombat: 93 })
    })

    const outcome = await run()
    expect(outcome).toMatchObject({ builds: [{ result: 'promoted', deliveryCalls: 6 }] })
    expect(world.log.filter(l => l.startsWith('fetch'))).toHaveLength(3)
    expect(await store.pendingEvents()).toEqual([])
  })

  it('keeps events the delivery API never showed pending, and still lets go of the lease', async () => {
    await run()
    await store.recordEvent({ entityId: ids.character('zoro'), entityType: 'Entry', kind: 'publish', revision: 7 })

    const outcome = await run()
    expect(outcome).toMatchObject({ status: 'done', builds: [{ result: 'unchanged', warnings: expect.arrayContaining([expect.objectContaining({ code: 'delivery-lag' })]) }] })
    expect((await store.pendingEvents()).map(e => e.revision)).toEqual([7])
    expect(await leaseFree()).toBe(true)
  })

  it('loops when an event arrives mid-build and time allows', async () => {
    await run()
    // Right after the next build's fetch, an editor publishes again.
    world.hooks.afterFetch.push(async () => {
      const revision = world.edit('bl-hero', { headline: 'Assemble your crew' })
      await store.recordEvent({ entityId: 'bl-hero', entityType: 'Entry', kind: 'publish', revision })
    })

    const outcome = await run()
    expect(outcome).toMatchObject({ builds: [{ result: 'unchanged' }, { result: 'promoted' }] })
    expect(await store.pendingEvents()).toEqual([])
    expect(await leaseFree()).toBe(true)
  })

  it('is fenced off when its lease expired mid-build and another builder took over', async () => {
    await run()
    const before = await store.currentPointer()
    world.log.length = 0
    world.edit(ids.character('zoro'), { statCombat: 93 })
    world.deps.putSnapshot = async (raw) => {
      await supabase.admin(`update public.content_lease set expires_at = clock_timestamp() - interval '1 second'`)
      await store.acquireLease('newer', 60)
      return `https://blob.example/raw/${raw}.json`
    }

    const outcome = await run()
    expect(outcome).toMatchObject({ builds: [{ result: 'fenced' }] })
    expect(await store.currentPointer()).toEqual(before)
    expect(world.log.some(l => l.startsWith('purge'))).toBe(false)
  })

  it('fails retryably when the delivery API is down, and frees the lease', async () => {
    world.hooks.fetchError = new DeliveryError('503 from cdn.contentful.com', 503)
    expect(await run()).toMatchObject({ retryable: true, builds: [{ result: 'failed', errors: [{ code: 'delivery' }] }] })
    expect(await leaseFree()).toBe(true)

    world.hooks.fetchError = new DeliveryError('401 from cdn.contentful.com', 401)
    expect(await run()).toMatchObject({ retryable: false })
  })

  it('retries a failed purge once, and records what the canary saw', async () => {
    world.hooks.purgeFailures = 1
    world.serveCanary('0'.repeat(64))
    const outcome = await run()
    expect(outcome).toMatchObject({ builds: [{ result: 'promoted', purge: 'retried: deleted', canary: `mismatch: ${'0'.repeat(64)}` }] })

    world.edit('bl-hero', { headline: 'Again' })
    world.hooks.purgeFailures = 2
    world.deps.canary = null
    expect(await run()).toMatchObject({ builds: [{ purge: 'failed: purge API 500', canary: 'skipped' }] })
  })
})
