import { describe, expect, it } from 'vitest'
import { checkCatalog, checkRules, rosterWarnings } from '#shared/engine'
import type { Rule } from '#shared/engine'
import { RULES } from '#shared/rules'
import { catalog, characters } from '../fixtures/catalog'
import { context } from './helpers'

const ctx = context()

const rule = (overrides: Partial<Rule>): Rule => ({
  key: 'test-rule',
  name: 'Test',
  conditions: [{ kind: 'character', character: 'luffy', position: 'any' }],
  effects: [{ op: 'add', stat: 'combat', amount: 1, scope: 'crew' }],
  unlocks: null,
  ...overrides,
})

const codes = (rules: Rule[]) => checkRules(ctx, rules)

describe('checkRules', () => {
  it('passes the real v1 rules', () => {
    expect(checkRules(ctx, RULES)).toEqual({ errors: [], warnings: [] })
  })

  it('catches what types cannot', () => {
    const errors = (r: Partial<Rule>) => codes([rule(r)]).errors.map(e => e.code)
    expect(errors({ conditions: [{ kind: 'character', character: 'lufy', position: 'any' }] })).toEqual(['unknown-character'])
    expect(errors({ conditions: [
      { kind: 'character', character: 'luffy', position: 'any' },
      { kind: 'character', character: 'luffy', position: 'captain' },
    ] })).toEqual(['repeated-character'])
    expect(errors({ effects: [], unlocks: 'gomu-gomu' })).toEqual(['not-compound'])
    expect(errors({ effects: [], unlocks: null })).toEqual(['no-outcome'])
    expect(errors({ effects: [{ op: 'add', stat: 'navigation', amount: 5, scope: 'cook' }] })).toEqual(['scope-mismatch'])
    expect(errors({ effects: [{ op: 'add', stat: 'combat', amount: 5, scope: 'cook' }] })).toEqual([])
    expect(errors({ conditions: [{ kind: 'anyOf', characters: ['luffy', 'zoro'], atLeast: 3 }] })).toEqual(['bad-threshold'])
    expect(errors({ conditions: [{ kind: 'attribute', attribute: 'haki', values: ['conqueror'], position: 'captain', atLeast: 2 }] })).toEqual(['bad-threshold'])
    expect(errors({ effects: [{ op: 'cap', stat: 'combat', amount: -1, scope: 'crew' }] })).toEqual(['bad-amount'])
    expect(codes([rule({}), rule({})]).errors.map(e => e.code)).toEqual(['duplicate-key'])
  })

  it('warns about former keys', () => {
    const result = codes([rule({ conditions: [{ kind: 'character', character: 'zolo', position: 'any' }] })])
    expect(result.errors).toEqual([])
    expect(result.warnings.map(w => w.code)).toEqual(['former-key'])
  })
})

describe('checkCatalog', () => {
  it('passes the fixture catalog', () => {
    expect(checkCatalog(catalog)).toEqual({ errors: [], warnings: [] })
  })

  it('catches bad stats, values and key collisions', () => {
    const luffy = characters[0]!
    const result = checkCatalog({
      ...catalog,
      characters: [
        ...characters,
        { ...luffy, key: 'luffy-2', formerKeys: ['zolo'], stats: { ...luffy.stats, combat: 101 }, faction: 'pirates' as never },
      ],
      objectives: [{ key: 'empty', name: 'Empty', weights: { combat: 0 }, requiredPositions: [] }],
    })
    expect(result.errors.map(e => e.code).sort()).toEqual(['key-collision', 'no-weights', 'stat-range', 'unknown-value'])
  })
})

describe('rosterWarnings', () => {
  it('flags positions with fewer than three in-role candidates', () => {
    const thin = rosterWarnings(ctx).map(w => w.subject)
    expect(thin).toEqual([
      'position navigator',
      'position sniper',
      'position cook',
      'position archaeologist',
      'position shipwright',
      'position musician',
      'position helmsman',
    ])
  })
})
