import { describe, expect, it } from 'vitest'
import { EngineError, complete, createContext, improve } from '#shared/engine'
import type { Rule } from '#shared/engine'
import { RULES } from '#shared/rules'
import { catalog } from '../fixtures/catalog'
import { context, crew } from './helpers'

const ctx = context()

describe('complete', () => {
  it('fills required positions first, then the best gains, with reasons', () => {
    const result = complete(ctx, [], 'grand-line')
    expect(result.score.missing).toEqual([])
    expect(result.crew).toContainEqual({ position: 'navigator', character: 'nami' })
    expect(result.crew).toContainEqual({ position: 'doctor', character: 'chopper' })
    expect(result.crew).toContainEqual({ position: 'cook', character: 'sanji' })
    expect(result.crew).toContainEqual({ position: 'helmsman', character: 'jinbe' })
    expect(result.steps[0]!.reason).toBe('Nami → Navigator: +35 combat, +95 navigation')
  })

  it('is deterministic', () => {
    expect(complete(ctx, [], 'brawl')).toEqual(complete(ctx, [], 'brawl'))
  })

  it('never changes placements already in the crew', () => {
    const start = crew('captain.luffy', 'navigator.zoro')
    const result = complete(ctx, start, 'grand-line')
    expect(result.crew).toContainEqual({ position: 'navigator', character: 'zoro' })
    expect(result.crew).toContainEqual({ position: 'captain', character: 'luffy' })
  })

  it('honors pins, exclusions and pools', () => {
    const pinned = complete(ctx, [], 'grand-line', { pins: [{ character: 'robin', position: 'navigator' }] })
    expect(pinned.crew).toContainEqual({ position: 'navigator', character: 'robin' })
    expect(pinned.steps[0]!.kind).toBe('pin')

    const excluded = complete(ctx, [], 'grand-line', { exclusions: ['nami'] })
    expect(excluded.crew.some(p => p.character === 'nami')).toBe(false)

    const pooled = complete(ctx, [], 'brawl', { pool: ['koby', 'killer'] })
    expect(pooled.crew.map(p => p.character).sort()).toEqual(['killer', 'koby'])
  })

  it('rejects a pin into a full position', () => {
    expect(() => complete(ctx, crew('navigator.nami'), 'grand-line', { pins: [{ character: 'robin', position: 'navigator' }] })).toThrow(EngineError)
  })

  it('finds pairs that only pay off together', () => {
    const sparring: Rule = {
      key: 'sparring-partners',
      name: 'Sparring Partners',
      conditions: [
        { kind: 'character', character: 'killer', position: 'any' },
        { kind: 'character', character: 'koby', position: 'any' },
      ],
      effects: [{ op: 'add', stat: 'morale', amount: 20, scope: 'crew' }],
      unlocks: null,
    }
    const local = createContext(catalog, [...RULES, sparring])
    // Morale only comes from the musician seat, which Brook already holds, so no single
    // placement helps: only placing Killer and Koby together does.
    const result = complete(local, crew('musician.brook'), 'festival', { pool: ['killer', 'koby', 'yamato'] })
    expect(result.steps.map(s => s.kind)).toEqual(['pair'])
    expect(result.steps[0]!.placements.map(p => p.character)).toEqual(['killer', 'koby'])
    expect(result.steps[0]!.reason).toContain('+20 morale')
  })
})

describe('improve', () => {
  it('swaps a full crew into better seats', () => {
    const start = crew('captain.luffy', 'first-mate.nami', 'navigator.zoro', 'doctor.chopper')
    const result = improve(ctx, start, 'grand-line', { pins: [{ character: 'luffy', position: 'captain' }], pool: [] })
    expect(result.crew).toContainEqual({ position: 'navigator', character: 'nami' })
    expect(result.crew).toContainEqual({ position: 'first-mate', character: 'zoro' })
    expect(result.steps.map(s => s.kind)).toEqual(['swap'])
    expect(result.steps[0]!.reason).toMatch(/^Roronoa Zoro ⇄ Nami: \+95 navigation/)
  })

  it('returns the same crew when nothing improves it', () => {
    const start = crew('captain.luffy', 'navigator.nami', 'doctor.chopper')
    const result = improve(ctx, start, 'grand-line', { pool: [] })
    expect(result.crew).toEqual(start)
    expect(result.steps).toEqual([])
  })
})
