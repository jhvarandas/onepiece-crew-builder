import type { EngineContext } from './context'
import { getCharacter, resolveKey } from './context'
import { canonicalize } from './crew'
import { FIT_PERCENT, POSITIONS, positionDef } from './positions'
import type {
  Character,
  Condition,
  Crew,
  Effect,
  Evaluation,
  FiredRule,
  Fit,
  PlacementResult,
  PositionCoverage,
  StatLine,
} from './types'
import { STATS } from './vocab'
import type { Stat } from './vocab'
import { ENGINE_VERSION } from './version'

// The evaluation pipeline (ARCHITECTURE.md §6.3). Integers only; order of placements
// and of rules can never change the result.

export function emptyStats(): StatLine {
  return Object.fromEntries(STATS.map(s => [s, 0])) as StatLine
}

export function fitOf(character: Character, position: PlacementResult['position']): Fit {
  return positionDef(position).inRole.some(role => character.roles.includes(role)) ? 'inRole' : 'offRole'
}

/** What one occupant supplies before rules: full combat anywhere, plus their position's owned stat at 100% or 50%. */
export function baseContribution(character: Character, position: PlacementResult['position']): StatLine {
  const line = emptyStats()
  line.combat = character.stats.combat
  const owns = positionDef(position).owns
  if (owns) {
    const percent = FIT_PERCENT[fitOf(character, position)]
    line[owns] = Math.floor((character.stats[owns] * percent) / 100)
  }
  return line
}

interface Occupant {
  position: PlacementResult['position']
  character: Character
  base: StatLine
}

export function evaluate(ctx: EngineContext, crew: Crew): Evaluation {
  const canonical = canonicalize(crew.map(p => ({ position: p.position, character: resolveKey(ctx, p.character) ?? p.character })))
  const occupants: Occupant[] = canonical.map(p => {
    const character = getCharacter(ctx, p.character)
    return { position: p.position, character, base: baseContribution(character, p.position) }
  })

  const baseTotals = emptyStats()
  for (const o of occupants) for (const s of STATS) baseTotals[s] += o.base[s]

  // Conditions read occupants, positions and base stats only, never another rule's result.
  const fired: FiredRule[] = ctx.rules
    .filter(rule => rule.conditions.every(c => holds(c, occupants, baseTotals)))
    .map(rule => ({ key: rule.key, name: rule.name, effects: rule.effects, unlocks: rule.unlocks }))

  const effects = fired.flatMap(r => r.effects)

  const placements: PlacementResult[] = occupants.map(o => {
    const final = emptyStats()
    for (const s of STATS) final[s] = applyEffects(o.base[s], effects.filter(e => e.scope === o.position && e.stat === s))
    return {
      position: o.position,
      character: o.character.key,
      fit: fitOf(o.character, o.position),
      base: o.base,
      final,
    }
  })

  const totals = emptyStats()
  for (const s of STATS) {
    const sum = placements.reduce((acc, p) => acc + p.final[s], 0)
    totals[s] = applyEffects(sum, effects.filter(e => e.scope === 'crew' && e.stat === s))
  }

  const coverage: PositionCoverage[] = POSITIONS.map(def => {
    const here = placements.filter(p => p.position === def.key)
    return {
      position: def.key,
      capacity: def.capacity,
      filled: here.length,
      inRole: here.filter(p => p.fit === 'inRole').length,
    }
  })

  const unlocks = [...new Set(fired.map(r => r.unlocks).filter((u): u is string => u !== null))].sort()

  return { engineVersion: ENGINE_VERSION, crew: canonical, baseTotals, totals, placements, coverage, rules: fired, unlocks }
}

/** Adds combine first, the result clamps at zero, then the lowest cap applies (§6.3 step 4). */
function applyEffects(value: number, effects: readonly Effect[]): number {
  if (effects.length === 0) return value
  let result = value
  for (const e of effects) if (e.op === 'add') result += e.amount
  result = Math.max(0, result)
  for (const e of effects) if (e.op === 'cap') result = Math.min(result, e.amount)
  return result
}

function holds(condition: Condition, occupants: readonly Occupant[], baseTotals: StatLine): boolean {
  switch (condition.kind) {
    case 'character':
      return occupants.some(o =>
        o.character.key === condition.character
        && (condition.position === 'any' || o.position === condition.position))
    case 'attribute': {
      const values = condition.values as readonly string[]
      const count = occupants.filter(o =>
        (condition.position === 'any' || o.position === condition.position)
        && attributeValues(o.character, condition.attribute).some(v => values.includes(v))).length
      return count >= condition.atLeast
    }
    case 'anyOf': {
      const count = occupants.filter(o => condition.characters.includes(o.character.key)).length
      return count >= condition.atLeast
    }
    case 'baseStat': {
      const value = condition.scope === 'crew'
        ? baseTotals[condition.stat]
        : sumAt(occupants, condition.scope, condition.stat)
      return value >= condition.atLeast
    }
  }
}

function sumAt(occupants: readonly Occupant[], position: Occupant['position'], stat: Stat): number {
  return occupants.filter(o => o.position === position).reduce((acc, o) => acc + o.base[stat], 0)
}

export function attributeValues(character: Character, attribute: 'role' | 'powerType' | 'faction' | 'haki'): readonly string[] {
  switch (attribute) {
    case 'role': return character.roles
    case 'powerType': return [character.powerType]
    case 'faction': return [character.faction]
    case 'haki': return character.haki
  }
}
