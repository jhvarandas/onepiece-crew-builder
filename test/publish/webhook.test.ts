import { signRequest } from '@contentful/node-apps-toolkit'
import { describe, expect, it } from 'vitest'
import { parseWebhook, verifySignature } from '../../server/publish/webhook'

const secret = 'k'.repeat(64)
const now = 1_792_000_000_000
const body = JSON.stringify({ sys: { id: 'ch-zoro', type: 'Entry', revision: 4, environment: { sys: { id: 'master' } } } })

/** Headers as Contentful would send them, signed by Contentful's own toolkit. */
function signed(path = '/api/hooks/content', extra: Record<string, string> = { 'x-contentful-topic': 'ContentManagement.Entry.publish' }) {
  const signature = signRequest(secret, { method: 'POST', path, headers: extra, body }, now)
  return { ...extra, ...signature }
}

describe('verifySignature', () => {
  it('accepts requests signed by Contentful\'s toolkit, including signed extra headers and a query', async () => {
    expect(await verifySignature(secret, { method: 'POST', path: '/api/hooks/content', headers: signed(), body }, now + 1000)).toEqual({ ok: true })
    const path = '/api/hooks/content?source=contentful&x=a b'
    expect(await verifySignature(secret, { method: 'POST', path, headers: signed(path), body }, now)).toEqual({ ok: true })
  })

  it('ignores header case and unsigned headers', async () => {
    const headers = Object.fromEntries(Object.entries(signed()).map(([k, v]) => [k.toUpperCase(), v]))
    expect(await verifySignature(secret, { method: 'post', path: '/api/hooks/content', headers: { ...headers, 'user-agent': 'x' }, body }, now)).toEqual({ ok: true })
  })

  it('rejects a changed body, path, signed header or secret', async () => {
    const headers = signed()
    const check = (over: Partial<{ path: string, headers: Record<string, string>, body: string }>, key = secret) =>
      verifySignature(key, { method: 'POST', path: '/api/hooks/content', headers, body, ...over }, now)
    expect(await check({ body: body.replace('4', '5') })).toEqual({ ok: false, reason: 'mismatch' })
    expect(await check({ path: '/api/hooks/other' })).toEqual({ ok: false, reason: 'mismatch' })
    expect(await check({ headers: { ...headers, 'x-contentful-topic': 'ContentManagement.Entry.delete' } })).toEqual({ ok: false, reason: 'mismatch' })
    expect(await check({}, 'j'.repeat(64))).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects unsigned and expired requests', async () => {
    expect(await verifySignature(secret, { method: 'POST', path: '/x', headers: {}, body }, now)).toEqual({ ok: false, reason: 'missing' })
    expect(await verifySignature(secret, { method: 'POST', path: '/api/hooks/content', headers: signed(), body }, now + 30_000)).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('parseWebhook', () => {
  const payload = (sys: Record<string, unknown>) => ({ sys: { id: 'ch-zoro', environment: { sys: { id: 'master' } }, ...sys } })

  it('reads publishes with their revision, and treats archive and delete as unpublish', () => {
    expect(parseWebhook('ContentManagement.Entry.publish', payload({ revision: 4 }), 'master'))
      .toEqual({ kind: 'event', event: { entityId: 'ch-zoro', entityType: 'Entry', kind: 'publish', revision: 4 } })
    for (const action of ['unpublish', 'archive', 'delete']) {
      expect(parseWebhook(`ContentManagement.Asset.${action}`, payload({ revision: 9 }), 'master'))
        .toEqual({ kind: 'event', event: { entityId: 'ch-zoro', entityType: 'Asset', kind: 'unpublish', revision: 0 } })
    }
  })

  it('ignores other topics, actions and environments', () => {
    expect(parseWebhook('ContentManagement.ContentType.publish', payload({}), 'master').kind).toBe('ignored')
    expect(parseWebhook('ContentManagement.Entry.auto_save', payload({}), 'master').kind).toBe('ignored')
    expect(parseWebhook('ContentManagement.Entry.publish', payload({ environment: { sys: { id: 'dev' } } }), 'master'))
      .toEqual({ kind: 'ignored', reason: 'environment dev' })
    expect(parseWebhook(undefined, payload({}), 'master').kind).toBe('ignored')
    expect(parseWebhook('ContentManagement.Entry.publish', null, 'master').kind).toBe('ignored')
  })
})
