import type { PositionKey, Stat } from '#shared/engine'
import { POSITIONS, STATS } from '#shared/engine'

// Field ids of the Contentful content model (ARCHITECTURE.md §5.2). The migration in
// contentful/migrations/ creates exactly these; test/content/model.test.ts keeps them in sync.

export const CONTENT_TYPES = [
  'page',
  'blockHero',
  'blockFeatureGrid',
  'blockCta',
  'blockTestimonial',
  'featureItem',
  'character',
  'ability',
  'crewPreset',
  'objective',
  'concept',
  'siteSettings',
] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

/** Entries the engine reads. Their hash is the catalog hash, together with the lexicon and their assets. */
export const CATALOG_TYPES: readonly ContentType[] = ['character', 'ability', 'crewPreset', 'objective']

export const BLOCK_TYPES: readonly ContentType[] = ['blockHero', 'blockFeatureGrid', 'blockCta', 'blockTestimonial']

/** Fields on siteSettings that belong to the catalog hash. */
export const LEXICON_FIELDS = ['namePatterns', 'nameAdjectives', 'nameNouns'] as const

export const CONCEPT_FACETS = ['theme', 'arc', 'affiliation', 'devilFruit', 'goal', 'audience'] as const

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/** character.statCombat, character.statLeadership, … (Contentful has no nested objects with validation). */
export const STAT_FIELDS = Object.fromEntries(STATS.map(s => [s, `stat${capitalize(s)}`])) as Record<Stat, string>

/** objective.weightCombat, … */
export const WEIGHT_FIELDS = Object.fromEntries(STATS.map(s => [s, `weight${capitalize(s)}`])) as Record<Stat, string>

/** One reference field per seat on crewPreset: captain, firstMate, combatant1, combatant2, navigator, … */
export const PRESET_SEAT_FIELDS: readonly { field: string, position: PositionKey }[] = POSITIONS.flatMap(p => {
  const base = p.key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  return p.capacity === 1
    ? [{ field: base, position: p.key }]
    : Array.from({ length: p.capacity }, (_, i) => ({ field: `${base}${i + 1}`, position: p.key }))
})

/** Link types a call to action's target may reference (§5.3). */
export const ACTION_TARGET_TYPES: readonly ContentType[] = ['page', 'crewPreset', 'objective', 'character']

/** Entry types a restricted Rich Text field may link to (D13). */
export const RICH_TEXT_LINK_TYPES: readonly ContentType[] = ['page', 'crewPreset', 'objective', 'character']

/** Slugs: lowercase segments separated by `/`. The home page is `index`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/
export const HOME_SLUG = 'index'
