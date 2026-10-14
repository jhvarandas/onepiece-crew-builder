import type { Ability, CatalogInput, Character, Objective, Rule } from './types'

// An engine context is one catalog plus one rule set, indexed once per snapshot.
// Everything else in the engine is a pure function of (context, input).

export interface RuleIndex {
  /** Rules whose character or anyOf conditions name this character. */
  byCharacter: ReadonlyMap<string, readonly Rule[]>
  /** Rules with at least one attribute condition. */
  byAttribute: readonly Rule[]
}

export interface EngineContext {
  characters: ReadonlyMap<string, Character>
  /** Former key → current key. */
  aliases: ReadonlyMap<string, string>
  /** Active character keys, sorted. Pickers and search draw from these. */
  activeKeys: readonly string[]
  abilities: ReadonlyMap<string, Ability>
  objectives: ReadonlyMap<string, Objective>
  /** Sorted by key, so evaluation never depends on authoring order. */
  rules: readonly Rule[]
  ruleIndex: RuleIndex
}

const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

export function createContext(catalog: CatalogInput, rules: readonly Rule[]): EngineContext {
  const characters = new Map(catalog.characters.map(c => [c.key, c]))
  const aliases = new Map<string, string>()
  for (const c of catalog.characters) {
    for (const former of c.formerKeys) aliases.set(former, c.key)
  }
  const activeKeys = catalog.characters
    .filter(c => c.status === 'active')
    .map(c => c.key)
    .sort()

  // Rules written against a key that was later renamed keep working through formerKeys.
  const current = (key: string) => (characters.has(key) ? key : aliases.get(key) ?? key)
  const sortedRules = rules.map(rule => resolveRuleKeys(rule, current)).sort(byKey)
  return {
    characters,
    aliases,
    activeKeys,
    abilities: new Map(catalog.abilities.map(a => [a.key, a])),
    objectives: new Map(catalog.objectives.map(o => [o.key, o])),
    rules: sortedRules,
    ruleIndex: buildRuleIndex(sortedRules),
  }
}

function resolveRuleKeys(rule: Rule, current: (key: string) => string): Rule {
  return {
    ...rule,
    conditions: rule.conditions.map((c) => {
      if (c.kind === 'character') return { ...c, character: current(c.character) }
      if (c.kind === 'anyOf') return { ...c, characters: c.characters.map(current) }
      return c
    }),
  }
}

function buildRuleIndex(rules: readonly Rule[]): RuleIndex {
  const byCharacter = new Map<string, Rule[]>()
  const byAttribute: Rule[] = []
  for (const rule of rules) {
    const named = new Set<string>()
    let hasAttribute = false
    for (const condition of rule.conditions) {
      if (condition.kind === 'character') named.add(condition.character)
      else if (condition.kind === 'anyOf') condition.characters.forEach(k => named.add(k))
      else if (condition.kind === 'attribute') hasAttribute = true
    }
    for (const key of named) {
      const list = byCharacter.get(key) ?? []
      list.push(rule)
      byCharacter.set(key, list)
    }
    if (hasAttribute) byAttribute.push(rule)
  }
  return { byCharacter, byAttribute }
}

/** The current key for a key or former key, or null if unknown. */
export function resolveKey(ctx: EngineContext, key: string): string | null {
  if (ctx.characters.has(key)) return key
  return ctx.aliases.get(key) ?? null
}

export function getCharacter(ctx: EngineContext, key: string): Character {
  const character = ctx.characters.get(key)
  if (!character) throw new EngineError(`Unknown character "${key}"`)
  return character
}

export function getObjective(ctx: EngineContext, key: string): Objective {
  const objective = ctx.objectives.get(key)
  if (!objective) throw new EngineError(`Unknown objective "${key}"`)
  return objective
}

/** Thrown for programming errors: unknown keys or impossible operations. User input goes through validateCrew. */
export class EngineError extends Error {
  override name = 'EngineError'
}
