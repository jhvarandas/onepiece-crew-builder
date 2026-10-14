import type { SnapshotHashes } from '#shared/types/content'
import type { SpaceContent } from './contentful'
import { derive } from './derive'
import type { DeriveOptions, DeriveResult } from './derive'
import { fromBytes, hashSnapshot, normalize, toBytes } from './raw'
import type { RawSnapshot } from './raw'

// Fetched content → raw snapshot R → derived snapshot. The webhook builder (publish path)
// and the deploy-time seed both go through here; readers that already hold R's bytes from
// Blob or the seed use deriveFromBytes.

export interface BuiltSnapshot {
  raw: RawSnapshot
  /** Exactly what gets uploaded to raw/<R>.json; R is the hash of these bytes. */
  bytes: Uint8Array
  hashes: SnapshotHashes
  result: DeriveResult
}

export async function buildSnapshot(content: SpaceContent, locale: string, options?: DeriveOptions): Promise<BuiltSnapshot> {
  const raw = normalize(content.entries, content.assets, locale)
  const bytes = toBytes(raw)
  const hashes = await hashSnapshot(raw, bytes)
  return { raw, bytes, hashes, result: derive(raw, hashes, options) }
}

/** Derives from stored bytes, checking they still hash to the R they were stored under. */
export async function deriveFromBytes(bytes: Uint8Array, expectedRaw: string, options?: DeriveOptions): Promise<DeriveResult> {
  const raw = fromBytes(bytes)
  const hashes = await hashSnapshot(raw, bytes)
  if (hashes.raw !== expectedRaw) throw new Error(`Snapshot bytes hash to ${hashes.raw}, expected ${expectedRaw}`)
  return derive(raw, hashes, options)
}
