import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONTENT_TYPES } from '../../server/content/model'
import { buildSnapshot } from '../../server/content/snapshot'
import { seed } from '../../contentful/seed.mjs'
import { spaceFixture } from '../fixtures/space'

const seedPath = fileURLToPath(new URL('../../contentful/seed.json', import.meta.url))

interface SeedEntry { id: string, contentType: string, fields: Record<string, unknown> }
interface SeedData { locale: string, entries: SeedEntry[] }

// Referenced types first, so each entry is published after the entries it links to.
const PUBLISH_ORDER = ['concept', 'ability', 'character', 'objective', 'crewPreset', 'featureItem', 'blockHero', 'blockFeatureGrid', 'blockCta', 'blockTestimonial', 'page', 'siteSettings']

/** The fixture space as seed data, without assets: the fixture's image URLs aren't real. */
function seedData(): SeedData {
  const entries = spaceFixture().entries.map((e) => {
    const fields = Object.fromEntries(Object.entries(e.fields ?? {}).filter(([k, v]) => v !== undefined && k !== 'portrait'))
    return { id: e.sys.id, contentType: e.sys.contentType!.sys.id, fields }
  })
  entries.sort((a, b) => PUBLISH_ORDER.indexOf(a.contentType) - PUBLISH_ORDER.indexOf(b.contentType))
  return { locale: 'en-US', entries }
}

const readSeed = (): SeedData => JSON.parse(readFileSync(seedPath, 'utf8'))

describe('contentful/seed.json', () => {
  it('matches the test fixtures (run `pnpm content:seed-data` to update)', () => {
    const expected = `${JSON.stringify(seedData(), null, 2)}\n`
    if (process.env.UPDATE_SEED) writeFileSync(seedPath, expected)
    expect(readFileSync(seedPath, 'utf8')).toBe(expected)
  })

  it('passes the strict validation gate, so a freshly seeded space builds', async () => {
    const data = readSeed()
    expect([...PUBLISH_ORDER].sort()).toEqual([...CONTENT_TYPES].sort())
    const entries = data.entries.map(e => ({ sys: { id: e.id, type: 'Entry', contentType: { sys: { id: e.contentType } } }, fields: e.fields }))
    const { result } = await buildSnapshot({ entries, assets: [], calls: 0 }, data.locale)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

/** Contentful stores an empty list as no value at all. */
const withoutEmptyLists = (fields: Record<string, Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(fields).filter(([, byLocale]) => !Object.values(byLocale).every(v => Array.isArray(v) && v.length === 0)))

/** An in-memory Content Management API with just the endpoints the seed uses. */
function fakeCma(contentTypes: readonly string[], { rateLimitOnce = false } = {}) {
  const store = new Map<string, { sys: { version: number, publishedVersion?: number, contentType: { sys: { id: string } } }, fields: unknown }>()
  const calls: string[] = []
  let limited = !rateLimitOnce
  const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    ({ ok: status < 300, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body) })

  const fetchFn = async (url: string, init: { method: string, headers: Record<string, string>, body?: string }) => {
    const path = new URL(url).pathname.replace('/spaces/sp1/environments/dev', '')
    calls.push(`${init.method} ${path}`)
    if (init.headers.Authorization !== 'Bearer cma-1') return reply(401)
    if (!limited) {
      limited = true
      return reply(429, {}, { 'X-Contentful-RateLimit-Reset': '1' })
    }
    if (path === '/content_types') return reply(200, { items: contentTypes.map(id => ({ sys: { id } })) })

    const [, , id, action] = path.split('/')
    const current = store.get(id!)
    if (init.method === 'GET') return current ? reply(200, current) : reply(404)
    if (action === 'published') {
      if (!current || String(current.sys.version) !== init.headers['X-Contentful-Version']) return reply(409)
      current.sys = { ...current.sys, publishedVersion: current.sys.version, version: current.sys.version + 1 }
      return reply(200, current)
    }
    if (current && String(current.sys.version) !== init.headers['X-Contentful-Version']) return reply(409)
    const type = current?.sys.contentType.sys.id ?? init.headers['X-Contentful-Content-Type']!
    const next = { sys: { ...current?.sys, version: (current?.sys.version ?? 0) + 1, contentType: { sys: { id: type } } }, fields: withoutEmptyLists(JSON.parse(init.body!).fields) }
    store.set(id!, next)
    return reply(current ? 200 : 201, next)
  }
  return { fetchFn, store, calls }
}

describe('contentful/seed.mjs', () => {
  const run = (cma: ReturnType<typeof fakeCma>, data = readSeed()) =>
    seed({ space: 'sp1', environment: 'dev', token: 'cma-1', data, fetchFn: cma.fetchFn, log: () => {}, sleep: async () => {} })

  it('creates and publishes every entry, with fields wrapped in the locale', async () => {
    const cma = fakeCma(CONTENT_TYPES)
    const data = readSeed()
    expect(await run(cma)).toEqual({ created: data.entries.length, updated: 0, unchanged: 0 })
    const luffy = cma.store.get('ch-luffy')!
    expect(luffy.sys.publishedVersion).toBe(1)
    expect(luffy.fields).toMatchObject({ key: { 'en-US': 'luffy' }, roles: { 'en-US': ['captain', 'fighter'] } })
  })

  it('is idempotent, and only republishes what changed', async () => {
    const cma = fakeCma(CONTENT_TYPES)
    await run(cma)
    const data = readSeed()
    expect(data.entries.some(e => Object.values(e.fields).some(v => Array.isArray(v) && v.length === 0))).toBe(true)
    expect(await run(cma)).toEqual({ created: 0, updated: 0, unchanged: data.entries.length })

    const edited = { ...data, entries: data.entries.map(e => (e.id === 'bl-hero' ? { ...e, fields: { ...e.fields, headline: 'Assemble your crew' } } : e)) }
    expect(await run(cma, edited)).toEqual({ created: 0, updated: 1, unchanged: data.entries.length - 1 })
    expect(cma.store.get('bl-hero')!.sys).toMatchObject({ version: 4, publishedVersion: 3 })
  })

  it('waits out rate limits, and stops when the content model is missing', async () => {
    const limited = fakeCma(CONTENT_TYPES, { rateLimitOnce: true })
    await run(limited)
    expect(limited.calls.slice(0, 2)).toEqual(['GET /content_types', 'GET /content_types'])

    await expect(run(fakeCma(['character']))).rejects.toThrow(/lacks content types .*Run the content-model migration first/)
  })
})
