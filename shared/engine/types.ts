import type { PositionKey } from './positions'
import type { AbilityKind, Faction, Haki, PowerType, Role, Stat } from './vocab'

// Domain types the engine reads. The Contentful adapter (server/content/) produces the
// catalog types; rules are typed data in code for v1 (ARCHITECTURE.md §7).

export type StatLine = Record<Stat, number>

export interface Character {
  key: string
  formerKeys: string[]
  status: 'active' | 'retired'
  name: string
  stats: StatLine
  roles: Role[]
  powerType: PowerType
  faction: Faction
  haki: Haki[]
}

export interface Ability {
  key: string
  name: string
  kind: AbilityKind
}

export interface Objective {
  key: string
  name: string
  /** Integer weights 0–5; missing stats weigh 0. */
  weights: Partial<Record<Stat, number>>
  requiredPositions: PositionKey[]
}

export interface CatalogInput {
  characters: Character[]
  abilities: Ability[]
  objectives: Objective[]
}

// ---------------------------------------------------------------------------
// Crews

export interface Placement {
  position: PositionKey
  character: string
}

/** A crew is a list of placements. Canonical crews are in position order, seats sorted by key. */
export type Crew = readonly Placement[]

// ---------------------------------------------------------------------------
// Rules (§6.4)

/** A position, or `any` for anywhere in the crew. */
export type PositionScope = PositionKey | 'any'

/** A position's contribution, or the crew total. */
export type EffectScope = PositionKey | 'crew'

export interface AttributeValues {
  role: Role
  powerType: PowerType
  faction: Faction
  haki: Haki
}
export type Attribute = keyof AttributeValues

export type AttributeCondition = {
  [A in Attribute]: {
    kind: 'attribute'
    attribute: A
    /** Matches occupants having any of these values. */
    values: AttributeValues[A][]
    position: PositionScope
    atLeast: number
  }
}[Attribute]

export type Condition =
  | { kind: 'character', character: string, position: PositionScope }
  | AttributeCondition
  | { kind: 'anyOf', characters: string[], atLeast: number }
  /** A threshold on base stats, before any rule applies, so rules never chain. */
  | { kind: 'baseStat', stat: Stat, scope: EffectScope, atLeast: number }

export interface Effect {
  op: 'add' | 'cap'
  stat: Stat
  amount: number
  scope: EffectScope
}

export interface Rule {
  key: string
  name: string
  /** All must hold. */
  conditions: Condition[]
  effects: Effect[]
  /** A compound ability this rule unlocks, or null. */
  unlocks: string | null
}

// ---------------------------------------------------------------------------
// Results. Every result is plain JSON so it can cross the Web Worker boundary and be stored.

export type Fit = 'inRole' | 'offRole'

export interface PlacementResult {
  position: PositionKey
  character: string
  fit: Fit
  /** Contribution before rules. */
  base: StatLine
  /** Contribution after position-scoped effects. */
  final: StatLine
}

export interface PositionCoverage {
  position: PositionKey
  capacity: number
  filled: number
  inRole: number
}

export interface FiredRule {
  key: string
  name: string
  effects: Effect[]
  unlocks: string | null
}

export interface Evaluation {
  engineVersion: number
  crew: Placement[]
  baseTotals: StatLine
  totals: StatLine
  placements: PlacementResult[]
  coverage: PositionCoverage[]
  rules: FiredRule[]
  /** Compound abilities unlocked, sorted by key. */
  unlocks: string[]
}

export interface Issue {
  code:
    | 'unknown-position'
    | 'position-full'
    | 'unknown-character'
    | 'duplicate-character'
    | 'retired-character'
    | 'missing-captain'
    | 'invalid-key'
  message: string
  position?: string
  character?: string
}
