import type { Role, Stat } from './vocab'

// Crew positions (ARCHITECTURE.md §6.2, decided 2026-10-14): the ten Straw Hat positions
// plus a combatant position with two interchangeable seats, twelve seats in all.

export interface PositionDef {
  readonly key: PositionKey
  readonly label: string
  /** How many characters this position seats. Seats in one position are interchangeable. */
  readonly capacity: number
  /** Characters with any of these roles sit here in role. */
  readonly inRole: readonly Role[]
  /** The stat only this position's occupant supplies, or null for a combat position. */
  readonly owns: Stat | null
}

export const POSITION_KEYS = [
  'captain',
  'first-mate',
  'combatant',
  'navigator',
  'sniper',
  'cook',
  'doctor',
  'archaeologist',
  'shipwright',
  'musician',
  'helmsman',
] as const
export type PositionKey = (typeof POSITION_KEYS)[number]

/** In code-defined order; canonical crews list placements in this order. */
export const POSITIONS: readonly PositionDef[] = [
  { key: 'captain', label: 'Captain', capacity: 1, inRole: ['captain'], owns: 'leadership' },
  { key: 'first-mate', label: 'First mate', capacity: 1, inRole: ['fighter', 'swordsman'], owns: null },
  { key: 'combatant', label: 'Combatant', capacity: 2, inRole: ['fighter', 'swordsman'], owns: null },
  { key: 'navigator', label: 'Navigator', capacity: 1, inRole: ['navigator'], owns: 'navigation' },
  { key: 'sniper', label: 'Sniper', capacity: 1, inRole: ['sniper'], owns: 'precision' },
  { key: 'cook', label: 'Cook', capacity: 1, inRole: ['cook'], owns: 'provisions' },
  { key: 'doctor', label: 'Doctor', capacity: 1, inRole: ['doctor'], owns: 'medicine' },
  { key: 'archaeologist', label: 'Archaeologist', capacity: 1, inRole: ['scholar'], owns: 'knowledge' },
  { key: 'shipwright', label: 'Shipwright', capacity: 1, inRole: ['shipwright'], owns: 'shipcraft' },
  { key: 'musician', label: 'Musician', capacity: 1, inRole: ['musician'], owns: 'morale' },
  { key: 'helmsman', label: 'Helmsman', capacity: 1, inRole: ['helmsman'], owns: 'helm' },
]

/** The position that must be filled before a crew can be saved. */
export const REQUIRED_TO_SAVE: PositionKey = 'captain'

/** Share of an owned stat an occupant supplies, in percent: one global pair (§6.3). */
export const FIT_PERCENT = { inRole: 100, offRole: 50 } as const

export const TOTAL_SEATS = POSITIONS.reduce((sum, p) => sum + p.capacity, 0)

const BY_KEY = new Map<string, PositionDef>(POSITIONS.map(p => [p.key, p]))
const ORDER = new Map<string, number>(POSITIONS.map((p, i) => [p.key, i]))

export function isPositionKey(value: string): value is PositionKey {
  return BY_KEY.has(value)
}

export function positionDef(key: PositionKey): PositionDef {
  return BY_KEY.get(key)!
}

export function positionOrder(key: PositionKey): number {
  return ORDER.get(key)!
}

/** The position that owns a stat, or null for `combat`. */
export function ownerOf(stat: Stat): PositionDef | null {
  return POSITIONS.find(p => p.owns === stat) ?? null
}
