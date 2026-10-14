import { describe, expect, it } from 'vitest'
import { DeliveryError, fetchSpace, unseenEvents } from '../../server/content/contentful'
import { entry } from '../fixtures/space'

const config = { space: 'sp1', environment: 'master', accessToken: 'token-1', locale: 'en-US' }

function fakeApi(counts: { entries: number, assets: number }, status = 200) {
  const requests: { url: URL, auth: string }[] = []
  const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
    const u = new URL(url)
    requests.push({ url: u, auth: init.headers.Authorization! })
    const kind = u.pathname.endsWith('/assets') ? 'assets' : 'entries'
    const skip = Number(u.searchParams.get('skip'))
    const limit = Number(u.searchParams.get('limit'))
    const total = counts[kind]
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - skip)) }, (_, i) => entry('ability', `${kind}-${skip + i}`, {}))
    return { ok: status === 200, status, json: async () => ({ items, total, skip, limit }) }
  }
  return { fetchFn, requests }
}

describe('fetchSpace', () => {
  it('pages through entries and assets, counting calls', async () => {
    const api = fakeApi({ entries: 1500, assets: 3 })
    const content = await fetchSpace(config, api.fetchFn)
    expect(content.entries).toHaveLength(1500)
    expect(content.assets).toHaveLength(3)
    expect(content.calls).toBe(3)
    expect(api.requests[0]!.url.toString()).toBe('https://cdn.contentful.com/spaces/sp1/environments/master/entries?locale=en-US&limit=1000&skip=0&include=0&order=sys.id')
    expect(api.requests.every(r => r.auth === 'Bearer token-1')).toBe(true)
  })

  it('raises retryable errors for rate limits and outages only', async () => {
    const limited = await fetchSpace(config, fakeApi({ entries: 1, assets: 0 }, 429).fetchFn).catch(e => e)
    expect(limited).toBeInstanceOf(DeliveryError)
    expect(limited.retryable).toBe(true)
    const unauthorized = await fetchSpace(config, fakeApi({ entries: 1, assets: 0 }, 401).fetchFn).catch(e => e)
    expect(unauthorized.retryable).toBe(false)
  })
})

describe('unseenEvents', () => {
  const content = { entries: [entry('character', 'a', {}, 3), entry('character', 'b', {}, 1)], assets: [], calls: 2 }

  it('finds publishes the delivery API doesn\'t show yet', () => {
    expect(unseenEvents(content, [
      { entityId: 'a', kind: 'publish', revision: 3 },
      { entityId: 'b', kind: 'publish', revision: 2 },
      { entityId: 'c', kind: 'publish', revision: 1 },
    ]).map(e => e.entityId)).toEqual(['b', 'c'])
  })

  it('finds unpublishes still visible, and only counts the latest event per entity', () => {
    expect(unseenEvents(content, [{ entityId: 'a', kind: 'unpublish', revision: 0 }]).map(e => e.entityId)).toEqual(['a'])
    expect(unseenEvents(content, [
      { entityId: 'a', kind: 'unpublish', revision: 0 },
      { entityId: 'a', kind: 'publish', revision: 3 },
    ])).toEqual([])
  })
})
