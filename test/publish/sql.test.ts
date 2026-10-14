import { beforeEach, describe, expect, it } from 'vitest'
import { supabaseStore } from '../../server/publish/supabase'
import type { BuildRecord, PublishStore } from '../../server/publish/store'
import { supabaseInMemory } from './postgrest'

const hash = (c: string) => c.repeat(64)
const snapshot = (c: string) => ({ rawHash: hash(c), catalogHash: hash('c'), pagesHash: hash('d'), bytes: 100, blobUrl: `https://blob.example/raw/${hash(c)}.json` })

let supabase: Awaited<ReturnType<typeof supabaseInMemory>>
let store: PublishStore

beforeEach(async () => {
  supabase = await supabaseInMemory()
  store = supabaseStore({ url: 'https://test.supabase.co', secretKey: 'sb_secret_test' }, supabase.fetchFn)
})

/** Moves the lease's expiry into the past, as if the holder had frozen. */
const expireLease = () => supabase.admin(`update public.content_lease set expires_at = clock_timestamp() - interval '1 second'`)

describe('the build lease', () => {
  it('is held by one builder at a time, each acquisition with a new generation', async () => {
    const g1 = await store.acquireLease('a', 60)
    expect(g1).toBe(1)
    expect(await store.acquireLease('b', 60)).toBeNull()
    expect(await store.releaseLease(g1!)).toBe('released')
    expect(await store.acquireLease('b', 60)).toBe(2)
  })

  it('can be taken over once expired, and the old generation is fenced off', async () => {
    const g1 = (await store.acquireLease('frozen', 60))!
    await store.indexSnapshot(snapshot('a'))
    await expireLease()
    const g2 = (await store.acquireLease('fresh', 60))!
    expect(g2).toBe(g1 + 1)

    expect(await store.promote(hash('a'), g1)).toBe(false)
    expect(await store.renewLease(g1, 60)).toBe(false)
    expect(await store.releaseLease(g1)).toBe('lost')
    expect(await store.currentPointer()).toBeNull()

    expect(await store.promote(hash('a'), g2)).toBe(true)
  })

  it('is released only when no unprocessed events remain, unless forced', async () => {
    const g = (await store.acquireLease('a', 60))!
    const id = await store.recordEvent({ entityId: 'ch-zoro', entityType: 'Entry', kind: 'publish', revision: 3 })
    expect(await store.releaseLease(g)).toBe('pending')
    expect(await store.markProcessed([id])).toBe(1)
    expect(await store.releaseLease(g)).toBe('released')

    const g2 = (await store.acquireLease('b', 60))!
    await store.recordEvent({ entityId: 'ch-nami', entityType: 'Entry', kind: 'unpublish', revision: 0 })
    expect(await store.releaseLease(g2, true)).toBe('released')
    expect(await store.acquireLease('c', 60)).toBe(g2 + 1)
  })
})

describe('events', () => {
  it('lists unprocessed events in order, and marks each processed once', async () => {
    const a = await store.recordEvent({ entityId: 'ch-zoro', entityType: 'Entry', kind: 'publish', revision: 3 })
    const b = await store.recordEvent({ entityId: 'as-luffy', entityType: 'Asset', kind: 'unpublish', revision: 0 })
    expect(await store.pendingEvents()).toEqual([
      { id: a, entityId: 'ch-zoro', kind: 'publish', revision: 3 },
      { id: b, entityId: 'as-luffy', kind: 'unpublish', revision: 0 },
    ])
    expect(await store.markProcessed([a])).toBe(1)
    expect(await store.markProcessed([a])).toBe(0)
    expect((await store.pendingEvents()).map(e => e.id)).toEqual([b])
  })

  it('rejects kinds and entity types outside the lists', async () => {
    await expect(store.recordEvent({ entityId: 'x', entityType: 'ContentType' as 'Entry', kind: 'publish', revision: 1 })).rejects.toThrow(/check constraint/)
  })
})

describe('snapshots and the pointer', () => {
  it('indexes content-addressed snapshots idempotently, and refuses to promote an unknown one', async () => {
    await store.indexSnapshot(snapshot('a'))
    await store.indexSnapshot(snapshot('a'))
    expect(await store.snapshotUrl(hash('a'))).toBe(snapshot('a').blobUrl)
    expect(await store.snapshotUrl(hash('b'))).toBeNull()

    const g = (await store.acquireLease('a', 60))!
    await expect(store.promote(hash('b'), g)).rejects.toThrow(/not indexed/)
  })

  it('points at one snapshot at a time, joined with its hashes and URL', async () => {
    const g = (await store.acquireLease('a', 60))!
    await store.indexSnapshot(snapshot('a'))
    await store.indexSnapshot(snapshot('b'))
    await store.promote(hash('a'), g)
    await store.promote(hash('b'), g)
    const { bytes: _, ...indexed } = snapshot('b')
    expect(await store.currentPointer()).toEqual({ ...indexed, generation: g, promotedAt: expect.any(String) })
    expect((await supabase.admin('select count(*)::int as n from public.content_pointer'))[0]).toEqual({ n: 1 })
  })
})

describe('the build log', () => {
  it('records a build', async () => {
    const build: BuildRecord = {
      trigger: 'webhook', generation: 4, startedAt: '2026-10-14T12:00:00.000Z', result: 'rejected',
      rawHash: hash('a'), catalogHash: null, pagesHash: null, deliveryCalls: 2, timings: { fetch: 310, total: 420 },
      errors: [{ severity: 'error', code: 'stat-range', subject: 'zoro', message: 'combat 120 is out of range' }], warnings: [], purge: null, canary: null,
    }
    const id = await store.recordBuild(build)
    const [row] = await supabase.admin('select trigger, generation::int, result, delivery_calls, timings, errors from public.content_builds where id = $1', [id])
    expect(row).toEqual({ trigger: 'webhook', generation: 4, result: 'rejected', delivery_calls: 2, timings: { fetch: 310, total: 420 }, errors: build.errors })
  })
})

describe('grants', () => {
  it('lets only the server role call the functions or read the tables', async () => {
    supabase.as('anon')
    await expect(store.acquireLease('anon', 60)).rejects.toThrow(/permission denied/)
    supabase.as('authenticated')
    await expect(store.currentPointer()).rejects.toThrow(/permission denied/)
    await supabase.db.exec('set role service_role')
    await expect(supabase.db.query('select * from public.content_lease')).rejects.toThrow(/permission denied/)
    await supabase.db.exec('reset role')
  })
})
