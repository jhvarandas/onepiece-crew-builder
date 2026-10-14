import type { EngineContext } from './context'
import { EngineError, getCharacter, resolveKey } from './context'
import type { PositionKey } from './positions'
import { REQUIRED_TO_SAVE, isPositionKey, positionDef, positionOrder } from './positions'
import type { Crew, Issue, Placement } from './types'
import { isKey } from './vocab'

// Canonical form, validation and edits (ARCHITECTURE.md §6.3 step 1, §6.7).

/** Position order, then character key within a position, so interchangeable seats never matter. */
export function canonicalize(crew: Crew): Placement[] {
  return [...crew]
    .map(p => ({ position: p.position, character: p.character }))
    .sort((a, b) =>
      positionOrder(a.position) - positionOrder(b.position)
      || (a.character < b.character ? -1 : a.character > b.character ? 1 : 0))
}

export interface ValidateOptions {
  /** Saving is stricter: the captain must be filled and retired characters are refused. */
  forSave?: boolean
}

export interface Validation {
  ok: boolean
  /** The valid placements, canonical, with former keys resolved. */
  crew: Placement[]
  issues: Issue[]
}

/** Checks untrusted placements (from a URL, a request body or the database). Never throws. */
export function validateCrew(
  ctx: EngineContext,
  input: readonly { position: string, character: string }[],
  options: ValidateOptions = {},
): Validation {
  const issues: Issue[] = []
  const kept: Placement[] = []
  const seen = new Set<string>()
  const filled = new Map<PositionKey, number>()

  for (const raw of input) {
    if (!isPositionKey(raw.position)) {
      issues.push({ code: 'unknown-position', message: `Unknown position "${raw.position}"`, position: raw.position })
      continue
    }
    if (!isKey(raw.character)) {
      issues.push({ code: 'invalid-key', message: `"${raw.character}" is not a valid key`, character: raw.character })
      continue
    }
    const key = resolveKey(ctx, raw.character)
    if (!key) {
      issues.push({ code: 'unknown-character', message: `Unknown character "${raw.character}"`, character: raw.character })
      continue
    }
    if (seen.has(key)) {
      issues.push({ code: 'duplicate-character', message: `${getCharacter(ctx, key).name} appears more than once`, character: key })
      continue
    }
    const position = raw.position
    const count = filled.get(position) ?? 0
    if (count >= positionDef(position).capacity) {
      issues.push({ code: 'position-full', message: `Too many characters at ${positionDef(position).label}`, position, character: key })
      continue
    }
    if (options.forSave && getCharacter(ctx, key).status === 'retired') {
      issues.push({ code: 'retired-character', message: `${getCharacter(ctx, key).name} is no longer available`, character: key })
      continue
    }
    seen.add(key)
    filled.set(position, count + 1)
    kept.push({ position, character: key })
  }

  if (options.forSave && !filled.get(REQUIRED_TO_SAVE)) {
    issues.push({ code: 'missing-captain', message: 'A crew needs a captain before it can be saved', position: REQUIRED_TO_SAVE })
  }

  return { ok: issues.length === 0, crew: canonicalize(kept), issues }
}

export function occupants(crew: Crew, position: PositionKey): string[] {
  return crew.filter(p => p.position === position).map(p => p.character)
}

export function positionOf(crew: Crew, character: string): PositionKey | null {
  return crew.find(p => p.character === character)?.position ?? null
}

export function hasRoom(crew: Crew, position: PositionKey): boolean {
  return occupants(crew, position).length < positionDef(position).capacity
}

/**
 * Puts a character in a position. If they're already elsewhere in the crew they move.
 * A full single-seat position loses its occupant; a full multi-seat position is an error (use replace).
 */
export function place(ctx: EngineContext, crew: Crew, position: PositionKey, character: string): Placement[] {
  const key = mustResolve(ctx, character)
  const rest = crew.filter(p => p.character !== key)
  if (hasRoom(rest, position)) return canonicalize([...rest, { position, character: key }])
  if (positionDef(position).capacity === 1) {
    return canonicalize([...rest.filter(p => p.position !== position), { position, character: key }])
  }
  throw new EngineError(`${positionDef(position).label} is full; replace one of its occupants instead`)
}

/** The new character takes the old one's seat. If the new character was elsewhere, that seat empties. */
export function replace(ctx: EngineContext, crew: Crew, current: string, next: string): Placement[] {
  const position = positionOf(crew, current)
  if (!position) throw new EngineError(`"${current}" is not in the crew`)
  const key = mustResolve(ctx, next)
  const rest = crew.filter(p => p.character !== current && p.character !== key)
  return canonicalize([...rest, { position, character: key }])
}

/** Moves a character to another position. A full single-seat position swaps its occupant into the vacated seat. */
export function move(crew: Crew, character: string, to: PositionKey): Placement[] {
  const from = positionOf(crew, character)
  if (!from) throw new EngineError(`"${character}" is not in the crew`)
  if (from === to) return canonicalize(crew)
  const rest = crew.filter(p => p.character !== character)
  if (hasRoom(rest, to)) return canonicalize([...rest, { position: to, character }])
  if (positionDef(to).capacity === 1) {
    return canonicalize(rest.map(p => (p.position === to ? { position: from, character: p.character } : p)).concat({ position: to, character }))
  }
  throw new EngineError(`${positionDef(to).label} is full`)
}

export function remove(crew: Crew, character: string): Placement[] {
  return canonicalize(crew.filter(p => p.character !== character))
}

function mustResolve(ctx: EngineContext, character: string): string {
  const key = resolveKey(ctx, character)
  if (!key) throw new EngineError(`Unknown character "${character}"`)
  return key
}
