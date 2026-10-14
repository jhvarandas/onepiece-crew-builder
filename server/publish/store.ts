import type { Problem } from '#shared/engine'
import type { ContentEvent } from '../content/contentful'

// What the publish path needs from Postgres (ARCHITECTURE.md §8.2). Each method is one of
// the functions in supabase/migrations/0001_content_publishing.sql; the invariants (lease
// generations, fencing, "release only when no events remain") live there, not here.

export interface PendingEvent extends ContentEvent {
  id: number
}

export interface NewEvent extends ContentEvent {
  entityType: 'Entry' | 'Asset'
}

export interface SnapshotIndex {
  rawHash: string
  catalogHash: string
  pagesHash: string
  bytes: number
  blobUrl: string
}

export interface Pointer {
  rawHash: string
  catalogHash: string
  pagesHash: string
  blobUrl: string
  generation: number
  promotedAt: string
}

/** 'pending': unprocessed events remain; 'lost': the generation is no longer current. */
export type ReleaseResult = 'released' | 'pending' | 'lost'

export type BuildResult = 'promoted' | 'unchanged' | 'rejected' | 'failed' | 'fenced'

/** A row of content_builds: everything needed to debug a publish after the logs are gone. */
export interface BuildRecord {
  trigger: string
  generation: number | null
  startedAt: string
  result: BuildResult
  rawHash: string | null
  catalogHash: string | null
  pagesHash: string | null
  deliveryCalls: number
  /** Milliseconds per step: fetch, derive, upload, promote, wait, purge, canary, total. */
  timings: Record<string, number>
  errors: Problem[]
  warnings: Problem[]
  purge: string | null
  canary: string | null
}

export interface PublishStore {
  recordEvent(event: NewEvent): Promise<number>
  acquireLease(holder: string, ttlSeconds: number): Promise<number | null>
  renewLease(generation: number, ttlSeconds: number): Promise<boolean>
  releaseLease(generation: number, force?: boolean): Promise<ReleaseResult>
  pendingEvents(): Promise<PendingEvent[]>
  markProcessed(ids: readonly number[]): Promise<number>
  snapshotUrl(rawHash: string): Promise<string | null>
  indexSnapshot(snapshot: SnapshotIndex): Promise<void>
  promote(rawHash: string, generation: number): Promise<boolean>
  currentPointer(): Promise<Pointer | null>
  recordBuild(build: BuildRecord): Promise<number>
}
