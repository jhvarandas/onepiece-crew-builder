import type { SnapshotHashes } from '#shared/types/content'
import { CATALOG_TYPES, LEXICON_FIELDS } from './model'

// The raw snapshot R (ARCHITECTURE.md §10.1): the whole published space, normalized and
// serialized to bytes. It doesn't depend on our transform code, only on this format, so
// every deployment can derive its own view of it. Bump RAW_FORMAT when the format changes.

export const RAW_FORMAT = 1

/** A link, normalized from Contentful's `{ sys: { type: 'Link', linkType, id } }`. */
export interface RawLink {
  $link: 'Entry' | 'Asset'
  id: string
}

export interface RawEntry {
  id: string
  type: string
  fields: Record<string, unknown>
}

export interface RawAsset {
  id: string
  title: string
  url: string
  contentType: string
  width: number | null
  height: number | null
}

export interface RawSnapshot {
  format: typeof RAW_FORMAT
  locale: string
  entries: RawEntry[]
  assets: RawAsset[]
}

// ---------------------------------------------------------------------------
// From the delivery API

/** The parts of a delivery-API item we read. Everything else is dropped. */
export interface DeliveryItem {
  sys: { id: string, type: string, revision?: number, contentType?: { sys: { id: string } } }
  fields?: Record<string, unknown>
}

/**
 * Builds R from delivery-API items fetched with a single locale. Strips editor metadata
 * (revisions, timestamps, tags), so republishing an unchanged entry doesn't change R.
 */
export function normalize(entries: readonly DeliveryItem[], assets: readonly DeliveryItem[], locale: string): RawSnapshot {
  return {
    format: RAW_FORMAT,
    locale,
    entries: entries
      .map(e => ({
        id: e.sys.id,
        type: e.sys.contentType?.sys.id ?? 'unknown',
        fields: normalizeValue(e.fields ?? {}) as Record<string, unknown>,
      }))
      .sort(byId),
    assets: assets.map(normalizeAsset).sort(byId),
  }
}

function normalizeAsset(a: DeliveryItem): RawAsset {
  const fields = (a.fields ?? {}) as {
    title?: string
    file?: { url?: string, contentType?: string, details?: { image?: { width?: number, height?: number } } }
  }
  const url = fields.file?.url ?? ''
  return {
    id: a.sys.id,
    title: fields.title ?? '',
    // The delivery API returns protocol-relative URLs.
    url: url.startsWith('//') ? `https:${url}` : url,
    contentType: fields.file?.contentType ?? '',
    width: fields.file?.details?.image?.width ?? null,
    height: fields.file?.details?.image?.height ?? null,
  }
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    const sys = (value as { sys?: { type?: string, linkType?: string, id?: string } }).sys
    if (sys?.type === 'Link' && (sys.linkType === 'Entry' || sys.linkType === 'Asset') && sys.id) {
      return { $link: sys.linkType, id: sys.id } satisfies RawLink
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeValue(v)]))
  }
  return value
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// ---------------------------------------------------------------------------
// Bytes and hashes

/** JSON with object keys sorted at every level, so equal content always gives equal bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys((value as Record<string, unknown>)[k])]))
  }
  return value
}

export function toBytes(snapshot: RawSnapshot): Uint8Array {
  return new TextEncoder().encode(canonicalJson(snapshot))
}

/** Parses bytes back. The hash of the bytes is the identity; never hash a re-serialized copy of stored JSON. */
export function fromBytes(bytes: Uint8Array): RawSnapshot {
  const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as RawSnapshot
  if (snapshot.format !== RAW_FORMAT) throw new Error(`Unsupported raw snapshot format ${snapshot.format}`)
  return snapshot
}

export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** R from the bytes; the catalog and pages hashes from the parts each one covers (§10.1). */
export async function hashSnapshot(snapshot: RawSnapshot, bytes: Uint8Array = toBytes(snapshot)): Promise<SnapshotHashes> {
  const [catalogPart, pagesPart] = splitParts(snapshot)
  const [raw, catalog, pages] = await Promise.all([sha256(bytes), sha256(canonicalJson(catalogPart)), sha256(canonicalJson(pagesPart))])
  return { raw, catalog, pages }
}

function splitParts(snapshot: RawSnapshot): [unknown, unknown] {
  const isCatalog = (e: RawEntry) => (CATALOG_TYPES as readonly string[]).includes(e.type)
  const catalogEntries = snapshot.entries.filter(isCatalog)
  const settings = snapshot.entries.filter(e => e.type === 'siteSettings')
  const lexicon = settings.map(e => ({ id: e.id, fields: pick(e.fields, LEXICON_FIELDS) }))
  const otherSettings = settings.map(e => ({ ...e, fields: omit(e.fields, LEXICON_FIELDS) }))
  const catalogAssetIds = new Set(collectLinks(catalogEntries).filter(l => l.$link === 'Asset').map(l => l.id))

  const catalogPart = {
    format: snapshot.format,
    locale: snapshot.locale,
    entries: catalogEntries,
    lexicon,
    assets: snapshot.assets.filter(a => catalogAssetIds.has(a.id)),
  }
  const pagesPart = {
    format: snapshot.format,
    locale: snapshot.locale,
    entries: [...snapshot.entries.filter(e => !isCatalog(e) && e.type !== 'siteSettings'), ...otherSettings],
    assets: snapshot.assets,
  }
  return [catalogPart, pagesPart]
}

export function collectLinks(value: unknown): RawLink[] {
  const out: RawLink[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      if ('$link' in v) out.push(v as RawLink)
      else Object.values(v).forEach(walk)
    }
  }
  walk(value)
  return out
}

function pick(fields: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => keys.includes(k)))
}

function omit(fields: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => !keys.includes(k)))
}
