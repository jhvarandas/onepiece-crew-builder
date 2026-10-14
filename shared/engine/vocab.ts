// Closed vocabularies the engine reads (ARCHITECTURE.md §5.3, principle 2).
// The content-model migration scripts copy these lists into Contentful's
// "accept only specified values" validations, so this file is the single source of truth.

/** Placeholder stat names; see §6.2. `combat` is shared, every other stat belongs to one position. */
export const STATS = [
  'combat',
  'leadership',
  'navigation',
  'precision',
  'provisions',
  'medicine',
  'knowledge',
  'shipcraft',
  'morale',
  'helm',
] as const
export type Stat = (typeof STATS)[number]

export const ROLES = [
  'captain',
  'fighter',
  'swordsman',
  'navigator',
  'sniper',
  'cook',
  'doctor',
  'scholar',
  'shipwright',
  'musician',
  'helmsman',
] as const
export type Role = (typeof ROLES)[number]

export const POWER_TYPES = ['none', 'paramecia', 'zoan', 'logia'] as const
export type PowerType = (typeof POWER_TYPES)[number]

/** Power types that make someone a Devil Fruit user. */
export const DEVIL_FRUIT_POWER_TYPES: readonly PowerType[] = ['paramecia', 'zoan', 'logia']

/** Current canon affiliation (§5.3). Arc-specific versions become separate characters. */
export const FACTIONS = [
  'straw-hat',
  'heart',
  'kid',
  'whitebeard',
  'red-hair',
  'big-mom',
  'beasts',
  'blackbeard',
  'cross-guild',
  'marine',
  'revolutionary',
  'world-government',
  'independent',
] as const
export type Faction = (typeof FACTIONS)[number]

export const HAKI = ['observation', 'armament', 'conqueror'] as const
export type Haki = (typeof HAKI)[number]

export const ABILITY_KINDS = ['devilFruit', 'haki', 'technique', 'compound'] as const
export type AbilityKind = (typeof ABILITY_KINDS)[number]

/** Stats are integers in this range on every character. */
export const STAT_MIN = 0
export const STAT_MAX = 100

/** Objective weights are integers in this range (§5.2). */
export const WEIGHT_MIN = 0
export const WEIGHT_MAX = 5

/** Readable keys: lowercase words joined by single hyphens. They never contain `.` or `~`, the URL separators. */
export const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}
