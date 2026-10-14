import {
  ABILITY_KINDS,
  FACTIONS,
  HAKI,
  KEY_PATTERN,
  POSITIONS,
  POWER_TYPES,
  ROLES,
  STATS,
  STAT_MAX,
  STAT_MIN,
  WEIGHT_MAX,
  WEIGHT_MIN,
} from '#shared/engine'
import {
  ACTION_TARGET_TYPES,
  BLOCK_TYPES,
  CONCEPT_FACETS,
  PRESET_SEAT_FIELDS,
  RICH_TEXT_LINK_TYPES,
  SLUG_PATTERN,
  STAT_FIELDS,
  WEIGHT_FIELDS,
} from './model'

// Everything the Contentful migration needs from code, as plain JSON. The migration copies
// these into Contentful's validations so code stays the single source of truth (§5.3).
// Written to contentful/vocab.json by `pnpm content:vocab`; a test fails when it's stale.

export function contentVocab() {
  return {
    keyPattern: KEY_PATTERN.source,
    slugPattern: SLUG_PATTERN.source,
    stats: STATS.map(stat => ({ stat, field: STAT_FIELDS[stat], weightField: WEIGHT_FIELDS[stat] })),
    statRange: { min: STAT_MIN, max: STAT_MAX },
    weightRange: { min: WEIGHT_MIN, max: WEIGHT_MAX },
    roles: [...ROLES],
    powerTypes: [...POWER_TYPES],
    factions: [...FACTIONS],
    haki: [...HAKI],
    abilityKinds: [...ABILITY_KINDS],
    positions: POSITIONS.map(p => p.key),
    presetSeats: PRESET_SEAT_FIELDS.map(s => ({
      ...s,
      label: POSITIONS.find(p => p.key === s.position)!.label + (s.field.match(/\d$/) ? ` ${s.field.slice(-1)}` : ''),
    })),
    conceptFacets: [...CONCEPT_FACETS],
    blockTypes: [...BLOCK_TYPES],
    actionTargetTypes: [...ACTION_TARGET_TYPES],
    richTextLinkTypes: [...RICH_TEXT_LINK_TYPES],
  }
}
