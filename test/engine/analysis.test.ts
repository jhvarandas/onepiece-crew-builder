import { describe, expect, it } from 'vitest'
import { compareCandidates, evaluate, explain, getObjective, pairsFromRules, placementGrid, rank, score } from '#shared/engine'
import { strawHats } from '../fixtures/catalog'
import { asCrew, context, crew } from './helpers'

const ctx = context()

describe('explain (leave-one-out)', () => {
  it('credits each member with what the crew loses without them', () => {
    const contributions = explain(ctx, asCrew(strawHats))
    const zoro = contributions.find(c => c.character === 'zoro')!
    expect(zoro.stats.combat).toBe(92 + 6)
    expect(zoro.unlocks).toEqual(['king-and-swordsman', 'monster-trio'])
    expect(zoro.rules).toEqual(['king-and-swordsman', 'monster-trio'])
    const robin = contributions.find(c => c.character === 'robin')!
    expect(robin.stats.knowledge).toBe(98)
    expect(robin.unlocks).toEqual([])
  })
})

describe('score and rank', () => {
  it('scores a crew under an objective and lists missing required positions', () => {
    const objective = getObjective(ctx, 'grand-line')
    const result = score(evaluate(ctx, crew('captain.luffy', 'navigator.nami')), objective)
    expect(result).toEqual({ objective: 'grand-line', score: 95 * 5, missing: ['doctor'] })
  })

  it('ranks candidates in one seat; ties go by key', () => {
    const ranked = rank(ctx, crew('captain.luffy'), { position: 'navigator' }, ['zoro', 'jinbe', 'nami'], 'grand-line')
    expect(ranked.map(r => r.character)).toEqual(['nami', 'jinbe', 'zoro'])
    expect(ranked[2]!.evaluation.totals.navigation).toBe(0)
  })

  it('compares without a lens in tray order', () => {
    const results = compareCandidates(ctx, crew('captain.luffy'), { position: 'archaeologist' }, ['brook', 'robin'])
    expect(results.map(r => r.character)).toEqual(['brook', 'robin'])
    expect(results[1]!.diff.stats.knowledge).toBe(98)
  })

  it('replaces a chosen occupant of a full multi-seat position', () => {
    const full = crew('captain.luffy', 'combatant.marco', 'combatant.yamato')
    const [result] = compareCandidates(ctx, full, { position: 'combatant', replacing: 'yamato' }, ['ace'])
    expect(result!.crew).toEqual(crew('captain.luffy', 'combatant.ace', 'combatant.marco'))
  })

  it('builds the candidate × position grid', () => {
    const cells = placementGrid(ctx, crew('captain.luffy', 'combatant.marco', 'combatant.yamato'), ['nami'], 'grand-line')
    expect(cells).toHaveLength(11)
    expect(cells.find(c => c.position === 'combatant')!.score).toBeNull()
    const navigator = cells.find(c => c.position === 'navigator')!.score!
    expect(Math.max(...cells.map(c => c.score ?? -1))).toBe(navigator)
  })
})

describe('pairsFromRules', () => {
  it('finds rules naming both characters', () => {
    expect(pairsFromRules(ctx, 'luffy', 'zoro').map(p => p.rule)).toEqual(['king-and-swordsman', 'monster-trio', 'supernovas'])
    expect(pairsFromRules(ctx, 'ace', 'luffy')).toEqual([{ rule: 'brothers', name: 'Brothers', reason: 'named' }])
  })

  it('only counts attribute rules both can satisfy together', () => {
    // Can't Swim needs one Devil Fruit user, so two users aren't a pair.
    expect(pairsFromRules(ctx, 'robin', 'brook')).toEqual([])
    expect(pairsFromRules(ctx, 'nami', 'usopp')).toEqual([])
  })
})
