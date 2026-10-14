import { canonicalize } from './crew'
import { TOTAL_SEATS } from './positions'
import type { Crew } from './types'

// The one crew serializer for URLs, on the server and in the browser (ARCHITECTURE.md §11).
// `.` and `~` are unreserved characters URL encoders never escape, and keys never contain
// them, so the canonical form can't drift between encoders.
//
//   captain.luffy~first-mate.zoro~combatant.marco~combatant.yamato

const ITEM = '~'
const PAIR = '.'

/** Generous bound so a hostile URL can't make the server parse megabytes. */
const MAX_LENGTH = 1024

export function serializeCrew(crew: Crew): string {
  return canonicalize(crew).map(p => `${p.position}${PAIR}${p.character}`).join(ITEM)
}

export interface ParsedCrew {
  /** Untrusted: run through validateCrew before use. */
  placements: { position: string, character: string }[]
  /** Items that weren't `position.character`. */
  malformed: string[]
}

export function parseCrew(value: string | null | undefined): ParsedCrew {
  const result: ParsedCrew = { placements: [], malformed: [] }
  if (!value) return result
  if (value.length > MAX_LENGTH) {
    result.malformed.push(value.slice(0, 40) + '…')
    return result
  }
  for (const item of value.split(ITEM).slice(0, TOTAL_SEATS * 2)) {
    const parts = item.split(PAIR)
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      result.malformed.push(item)
      continue
    }
    result.placements.push({ position: parts[0], character: parts[1] })
  }
  return result
}

/** Key lists such as `c=robin~brook` and `x=blackbeard`. Order is kept: compare trays keep tray order. */
export function serializeKeys(keys: readonly string[]): string {
  return keys.join(ITEM)
}

export function parseKeys(value: string | null | undefined, limit = 32): string[] {
  if (!value || value.length > MAX_LENGTH) return []
  return value.split(ITEM).filter(Boolean).slice(0, limit)
}
