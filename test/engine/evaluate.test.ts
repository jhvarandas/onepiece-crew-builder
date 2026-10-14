import { describe, expect, it } from 'vitest'
import { diff, evaluate, serializeCrew } from '#shared/engine'
import type { Rule } from '#shared/engine'
import { RULES } from '#shared/rules'
import { strawHats } from '../fixtures/catalog'
import { asCrew, context, crew, shuffle } from './helpers'

const ctx = context()

describe('evaluate: golden crews', () => {
  it('scores the canonical Straw Hat crew', () => {
    const result = evaluate(ctx, asCrew(strawHats))
    expect(result.baseTotals.combat).toBe(700)
    expect(result.totals).toEqual({
      combat: 706, // + Monster Trio
      leadership: 90,
      navigation: 95,
      precision: 92,
      provisions: 98,
      medicine: 95,
      knowledge: 98,
      shipcraft: 96,
      morale: 95,
      helm: 96,
    })
    expect(result.rules.map(r => r.key)).toEqual(['king-and-swordsman', 'monster-trio'])
    expect(result.unlocks).toEqual(['king-and-swordsman', 'monster-trio'])
    expect(result.placements.every(p => p.fit === 'inRole')).toBe(true)
    expect(result.coverage.find(c => c.position === 'combatant')).toEqual({ position: 'combatant', capacity: 2, filled: 0, inRole: 0 })
  })

  it('Hopelessly Lost: Zoro at navigator supplies no navigation, but full combat', () => {
    const result = evaluate(ctx, crew('captain.luffy', 'navigator.zoro'))
    const zoro = result.placements.find(p => p.character === 'zoro')!
    expect(zoro.fit).toBe('offRole')
    expect(zoro.base.navigation).toBe(1) // 50% of 2, rounded down
    expect(zoro.final.navigation).toBe(0)
    expect(result.totals.navigation).toBe(0)
    expect(result.totals.combat).toBe(95 + 92)
    expect(result.rules.map(r => r.key)).toEqual(['hopelessly-lost'])
  })

  it('off-role occupants supply half their owned stat, rounded down', () => {
    const result = evaluate(ctx, crew('helmsman.nami'))
    expect(result.totals.helm).toBe(20)
    expect(result.totals.navigation).toBe(0) // the navigator position is empty
  })

  it('Can\'t Swim: a Devil Fruit user at helmsman loses 4 helm', () => {
    expect(evaluate(ctx, crew('helmsman.robin')).totals.helm).toBe(5 - 4)
    expect(evaluate(ctx, crew('helmsman.jinbe')).totals.helm).toBe(96)
  })

  it('Brothers adds leadership to the captain\'s contribution', () => {
    const result = evaluate(ctx, crew('captain.luffy', 'combatant.ace'))
    expect(result.totals.leadership).toBe(95)
    expect(result.placements.find(p => p.character === 'luffy')!.final.leadership).toBe(95)
  })

  it('Supernovas needs any three of the Worst Generation', () => {
    expect(evaluate(ctx, crew('captain.luffy', 'first-mate.zoro')).rules.map(r => r.key)).not.toContain('supernovas')
    const three = evaluate(ctx, crew('captain.luffy', 'first-mate.zoro', 'doctor.law'))
    expect(three.rules.map(r => r.key)).toContain('supernovas')
    expect(three.totals.combat).toBe(95 + 92 + 88 + 3)
  })

  it('an empty crew is all zeros', () => {
    const result = evaluate(ctx, [])
    expect(Object.values(result.totals).every(v => v === 0)).toBe(true)
    expect(result.rules).toEqual([])
  })

  it('resolves former keys', () => {
    expect(evaluate(ctx, crew('first-mate.zolo')).crew).toEqual(crew('first-mate.zoro'))
  })
})

describe('evaluate: effects', () => {
  const boost = (key: string, amount: number, op: 'add' | 'cap' = 'add'): Rule => ({
    key,
    name: key,
    conditions: [{ kind: 'character', character: 'nami', position: 'navigator' }],
    effects: [{ op, stat: 'navigation', amount, scope: 'navigator' }],
    unlocks: null,
  })

  it('applies adds, then clamps at zero, then the lowest cap', () => {
    const nav = (rules: Rule[]) => evaluate(context(rules), crew('navigator.nami')).totals.navigation
    expect(nav([boost('a', 10)])).toBe(105)
    expect(nav([boost('a', 10), boost('b', 50, 'cap')])).toBe(50)
    expect(nav([boost('a', 10), boost('b', 50, 'cap'), boost('c', 70, 'cap')])).toBe(50)
    expect(nav([boost('a', -200)])).toBe(0)
    expect(nav([boost('a', -200), boost('b', 5, 'cap')])).toBe(0)
  })

  it('crew-scoped effects apply to the total after position effects', () => {
    const rules: Rule[] = [
      boost('a', -90),
      { key: 'b', name: 'b', conditions: [{ kind: 'baseStat', stat: 'navigation', scope: 'crew', atLeast: 90 }], effects: [{ op: 'add', stat: 'navigation', amount: 3, scope: 'crew' }], unlocks: null },
    ]
    // baseStat reads the base (95), before rule a lowers the contribution to 5.
    expect(evaluate(context(rules), crew('navigator.nami')).totals.navigation).toBe(8)
  })
})

describe('evaluate: invariants', () => {
  const crews = [
    asCrew(strawHats),
    crew('captain.luffy', 'navigator.zoro', 'combatant.ace', 'combatant.marco', 'doctor.law'),
    crew('captain.kid', 'first-mate.killer', 'helmsman.brook', 'combatant.yamato', 'combatant.hawkins'),
  ]

  it('same input, same output; input order and rule order never matter', () => {
    for (const c of crews) {
      const expected = evaluate(ctx, c)
      for (let seed = 1; seed <= 20; seed++) {
        const shuffled = context(shuffle(RULES, seed))
        expect(evaluate(shuffled, shuffle(c, seed * 7))).toEqual(expected)
      }
    }
  })

  it('interchangeable seats are one crew', () => {
    const a = crew('combatant.marco', 'combatant.yamato')
    const b = crew('combatant.yamato', 'combatant.marco')
    expect(evaluate(ctx, a)).toEqual(evaluate(ctx, b))
    expect(serializeCrew(a)).toBe(serializeCrew(b))
  })

  it('survives a JSON round trip', () => {
    for (const c of crews) {
      const result = evaluate(ctx, c)
      expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    }
  })

  it('diffs agree with evaluations', () => {
    const [a, b] = [evaluate(ctx, crews[0]!), evaluate(ctx, crews[1]!)]
    const d = diff(a, b)
    for (const s of Object.keys(d.stats) as (keyof typeof d.stats)[]) {
      expect(d.stats[s]).toBe(b.totals[s] - a.totals[s])
    }
    expect(d.unlocksLost).toEqual(['king-and-swordsman', 'monster-trio'])
    expect(d.moved).toEqual([{ character: 'zoro', from: 'first-mate', to: 'navigator' }])
    const same = diff(a, a)
    expect(Object.values(same.stats).every(v => v === 0)).toBe(true)
    expect([same.added, same.removed, same.moved, same.rulesGained, same.rulesLost]).toEqual([[], [], [], [], []])
  })
})
