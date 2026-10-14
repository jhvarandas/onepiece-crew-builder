import type { EngineContext } from './context'
import { POSITIONS, isPositionKey, positionDef } from './positions'
import type { CatalogInput, EffectScope, Rule } from './types'
import {
  ABILITY_KINDS,
  FACTIONS,
  HAKI,
  POWER_TYPES,
  ROLES,
  STATS,
  STAT_MAX,
  STAT_MIN,
  WEIGHT_MAX,
  WEIGHT_MIN,
  isKey,
} from './vocab'
import type { Stat } from './vocab'

// Checks that types can't express (ARCHITECTURE.md §6.4, §6.2). They run in CI against the
// real rules, and again when the snapshot builder validates a publish. Errors block
// promotion (strict in v1); warnings are reported on /status.

export interface Problem {
  severity: 'error' | 'warning'
  code: string
  subject: string
  message: string
}

export interface CheckResult {
  errors: Problem[]
  warnings: Problem[]
}

function collect(problems: Problem[]): CheckResult {
  return {
    errors: problems.filter(p => p.severity === 'error'),
    warnings: problems.filter(p => p.severity === 'warning'),
  }
}

/** Shape and range checks on catalog data coming from Contentful. */
export function checkCatalog(catalog: CatalogInput): CheckResult {
  const problems: Problem[] = []
  const error = (code: string, subject: string, message: string) => problems.push({ severity: 'error', code, subject, message })

  const claimed = new Map<string, string>()
  const claim = (key: string, owner: string) => {
    const other = claimed.get(key)
    if (other && other !== owner) error('key-collision', key, `"${key}" is used by both ${other} and ${owner}`)
    claimed.set(key, owner)
  }

  for (const c of catalog.characters) {
    const subject = `character ${c.key}`
    if (!isKey(c.key)) error('invalid-key', subject, `"${c.key}" is not a valid key`)
    if (claimed.get(c.key) === c.key) error('duplicate-key', subject, `Character "${c.key}" appears twice`)
    claim(c.key, c.key)
    for (const former of c.formerKeys) {
      if (!isKey(former)) error('invalid-key', subject, `Former key "${former}" is not a valid key`)
      claim(former, c.key)
    }
    for (const s of STATS) {
      const v = c.stats[s]
      if (!Number.isInteger(v) || v < STAT_MIN || v > STAT_MAX) error('stat-range', subject, `${s} must be an integer ${STAT_MIN}–${STAT_MAX}, got ${v}`)
    }
    if (c.roles.length === 0) error('no-roles', subject, 'A character needs at least one role')
    for (const r of c.roles) if (!(ROLES as readonly string[]).includes(r)) error('unknown-value', subject, `Unknown role "${r}"`)
    if (!(POWER_TYPES as readonly string[]).includes(c.powerType)) error('unknown-value', subject, `Unknown power type "${c.powerType}"`)
    if (!(FACTIONS as readonly string[]).includes(c.faction)) error('unknown-value', subject, `Unknown faction "${c.faction}"`)
    for (const h of c.haki) if (!(HAKI as readonly string[]).includes(h)) error('unknown-value', subject, `Unknown Haki "${h}"`)
  }

  const abilityKeys = new Set<string>()
  for (const a of catalog.abilities) {
    if (!isKey(a.key)) error('invalid-key', `ability ${a.key}`, `"${a.key}" is not a valid key`)
    if (abilityKeys.has(a.key)) error('duplicate-key', `ability ${a.key}`, `Ability "${a.key}" appears twice`)
    abilityKeys.add(a.key)
    if (!(ABILITY_KINDS as readonly string[]).includes(a.kind)) error('unknown-value', `ability ${a.key}`, `Unknown kind "${a.kind}"`)
  }

  const objectiveKeys = new Set<string>()
  for (const o of catalog.objectives) {
    const subject = `objective ${o.key}`
    if (!isKey(o.key)) error('invalid-key', subject, `"${o.key}" is not a valid key`)
    if (objectiveKeys.has(o.key)) error('duplicate-key', subject, `Objective "${o.key}" appears twice`)
    objectiveKeys.add(o.key)
    for (const [stat, weight] of Object.entries(o.weights)) {
      if (!(STATS as readonly string[]).includes(stat)) error('unknown-value', subject, `Unknown stat "${stat}"`)
      if (!Number.isInteger(weight) || weight! < WEIGHT_MIN || weight! > WEIGHT_MAX) {
        error('weight-range', subject, `Weight for ${stat} must be an integer ${WEIGHT_MIN}–${WEIGHT_MAX}, got ${weight}`)
      }
    }
    if (!Object.values(o.weights).some(w => (w ?? 0) > 0)) error('no-weights', subject, 'An objective needs at least one positive weight')
    for (const p of o.requiredPositions) if (!isPositionKey(p)) error('unknown-value', subject, `Unknown position "${p}"`)
  }

  return collect(problems)
}

/** Cross-reference checks on rules against a catalog. */
export function checkRules(ctx: EngineContext, rules: readonly Rule[]): CheckResult {
  const problems: Problem[] = []
  const seen = new Set<string>()

  for (const rule of rules) {
    const subject = `rule ${rule.key}`
    const error = (code: string, message: string) => problems.push({ severity: 'error', code, subject, message })
    const warning = (code: string, message: string) => problems.push({ severity: 'warning', code, subject, message })

    if (!isKey(rule.key)) error('invalid-key', `"${rule.key}" is not a valid key`)
    if (seen.has(rule.key)) error('duplicate-key', `Rule "${rule.key}" appears twice`)
    seen.add(rule.key)
    if (rule.conditions.length === 0) error('no-conditions', 'A rule needs at least one condition')
    if (rule.effects.length === 0 && rule.unlocks === null) error('no-outcome', 'A rule needs an effect or an unlock')

    const named: string[] = []
    const checkCharacter = (key: string) => {
      if (ctx.characters.has(key)) named.push(key)
      else if (ctx.aliases.has(key)) {
        named.push(ctx.aliases.get(key)!)
        warning('former-key', `"${key}" is a former key of "${ctx.aliases.get(key)}"; update the rule`)
      }
      else error('unknown-character', `Unknown character "${key}"`)
    }

    for (const c of rule.conditions) {
      switch (c.kind) {
        case 'character':
          checkCharacter(c.character)
          if (c.position !== 'any' && !isPositionKey(c.position)) error('unknown-position', `Unknown position "${c.position}"`)
          break
        case 'anyOf':
          c.characters.forEach(checkCharacter)
          if (!Number.isInteger(c.atLeast) || c.atLeast < 1 || c.atLeast > c.characters.length) {
            error('bad-threshold', `anyOf needs 1 ≤ atLeast ≤ ${c.characters.length}, got ${c.atLeast}`)
          }
          break
        case 'attribute':
          if (c.values.length === 0) error('no-values', 'An attribute condition needs at least one value')
          if (!Number.isInteger(c.atLeast) || c.atLeast < 1) error('bad-threshold', `atLeast must be a positive integer, got ${c.atLeast}`)
          if (c.position !== 'any') {
            if (!isPositionKey(c.position)) error('unknown-position', `Unknown position "${c.position}"`)
            else if (c.atLeast > positionDef(c.position).capacity) {
              error('bad-threshold', `${positionDef(c.position).label} seats ${positionDef(c.position).capacity}, so atLeast ${c.atLeast} can never hold`)
            }
          }
          break
        case 'baseStat':
          if (!Number.isInteger(c.atLeast) || c.atLeast < 1) error('bad-threshold', `atLeast must be a positive integer, got ${c.atLeast}`)
          checkScope(c.scope, c.stat, error)
          break
      }
    }

    // A rule naming the same character twice is almost always a typo (X ≠ Y).
    const duplicates = named.filter((k, i) => named.indexOf(k) !== i)
    for (const k of new Set(duplicates)) error('repeated-character', `"${k}" is named more than once`)

    for (const e of rule.effects) {
      if (!Number.isInteger(e.amount)) error('bad-amount', `Effect amounts are integers, got ${e.amount}`)
      if (e.op === 'cap' && e.amount < 0) error('bad-amount', 'A cap below zero can never apply, since totals clamp at zero')
      if (e.op === 'add' && e.amount === 0) warning('no-op', 'An add of 0 does nothing')
      checkScope(e.scope, e.stat, error)
    }

    if (rule.unlocks !== null) {
      const ability = ctx.abilities.get(rule.unlocks)
      if (!ability) error('unknown-ability', `Unknown ability "${rule.unlocks}"`)
      else if (ability.kind !== 'compound') error('not-compound', `"${rule.unlocks}" is a ${ability.kind} ability; rules only unlock compound abilities`)
    }
  }

  return collect(problems)
}

/** A position-scoped stat only makes sense where that position supplies the stat. */
function checkScope(scope: EffectScope, stat: Stat, error: (code: string, message: string) => void) {
  if (scope === 'crew') return
  if (!isPositionKey(scope)) {
    error('unknown-position', `Unknown position "${scope}"`)
    return
  }
  const def = positionDef(scope)
  if (stat !== 'combat' && def.owns !== stat) {
    error('scope-mismatch', `${def.label} doesn't supply ${stat}; scope it to the position that owns ${stat}, or to the crew`)
  }
}

/** Builder warnings: thin positions and characters who are in role nowhere (§6.2). */
export function rosterWarnings(ctx: EngineContext, minimumCandidates = 3): Problem[] {
  const active = ctx.activeKeys.map(k => ctx.characters.get(k)!)
  const problems: Problem[] = []
  for (const def of POSITIONS) {
    const count = active.filter(c => def.inRole.some(r => c.roles.includes(r))).length
    if (count < minimumCandidates) {
      problems.push({
        severity: 'warning',
        code: 'thin-position',
        subject: `position ${def.key}`,
        message: `${def.label} has ${count} in-role candidate${count === 1 ? '' : 's'} (fewer than ${minimumCandidates})`,
      })
    }
  }
  for (const c of active) {
    if (!POSITIONS.some(def => def.inRole.some(r => c.roles.includes(r)))) {
      problems.push({ severity: 'warning', code: 'no-home', subject: `character ${c.key}`, message: `${c.name} is in role nowhere` })
    }
  }
  return problems
}
