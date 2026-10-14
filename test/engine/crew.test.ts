import { describe, expect, it } from 'vitest'
import { EngineError, move, parseCrew, parseKeys, place, remove, replace, serializeCrew, serializeKeys, validateCrew } from '#shared/engine'
import { context, crew } from './helpers'

const ctx = context()

describe('validateCrew', () => {
  it('keeps valid placements, canonicalizes them and resolves former keys', () => {
    const result = validateCrew(ctx, crew('navigator.nami', 'captain.luffy', 'first-mate.zolo'))
    expect(result.ok).toBe(true)
    expect(result.crew).toEqual(crew('captain.luffy', 'first-mate.zoro', 'navigator.nami'))
  })

  it('reports each problem and drops only the offending placements', () => {
    const result = validateCrew(ctx, [
      { position: 'captain', character: 'luffy' },
      { position: 'lookout', character: 'usopp' },
      { position: 'cook', character: 'sanjo' },
      { position: 'doctor', character: 'luffy' },
      { position: 'combatant', character: 'marco' },
      { position: 'combatant', character: 'yamato' },
      { position: 'combatant', character: 'ace' },
      { position: 'sniper', character: 'Not A Key' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues.map(i => i.code)).toEqual([
      'unknown-position',
      'unknown-character',
      'duplicate-character',
      'position-full',
      'invalid-key',
    ])
    expect(result.crew).toEqual(crew('captain.luffy', 'combatant.marco', 'combatant.yamato'))
  })

  it('shows retired characters in old crews but refuses them in new saves', () => {
    expect(validateCrew(ctx, crew('captain.kuro')).ok).toBe(true)
    expect(validateCrew(ctx, crew('captain.kuro'), { forSave: true }).issues.map(i => i.code)).toEqual(['retired-character', 'missing-captain'])
  })

  it('needs a captain to save', () => {
    expect(validateCrew(ctx, crew('navigator.nami'), { forSave: true }).issues.map(i => i.code)).toEqual(['missing-captain'])
    expect(validateCrew(ctx, crew('captain.luffy'), { forSave: true }).ok).toBe(true)
  })
})

describe('edits', () => {
  const base = crew('captain.luffy', 'first-mate.zoro', 'navigator.nami', 'combatant.marco', 'combatant.yamato')

  it('place adds to an open seat, moving the character if already placed', () => {
    expect(place(ctx, base, 'doctor', 'chopper')).toContainEqual({ position: 'doctor', character: 'chopper' })
    const moved = place(ctx, base, 'helmsman', 'nami')
    expect(moved).toContainEqual({ position: 'helmsman', character: 'nami' })
    expect(moved.some(p => p.position === 'navigator')).toBe(false)
  })

  it('place into a full single seat displaces its occupant', () => {
    const next = place(ctx, base, 'navigator', 'jinbe')
    expect(next).toContainEqual({ position: 'navigator', character: 'jinbe' })
    expect(next.some(p => p.character === 'nami')).toBe(false)
  })

  it('place into a full multi-seat position is an error', () => {
    expect(() => place(ctx, base, 'combatant', 'ace')).toThrow(EngineError)
  })

  it('replace takes the old seat', () => {
    expect(replace(ctx, base, 'yamato', 'ace')).toEqual(crew('captain.luffy', 'first-mate.zoro', 'combatant.ace', 'combatant.marco', 'navigator.nami'))
  })

  it('move swaps with the occupant of a full single seat', () => {
    expect(move(base, 'zoro', 'navigator')).toEqual(crew('captain.luffy', 'first-mate.nami', 'combatant.marco', 'combatant.yamato', 'navigator.zoro'))
    expect(() => move(base, 'luffy', 'combatant')).toThrow(EngineError)
  })

  it('remove empties the seat', () => {
    expect(remove(base, 'marco')).toEqual(crew('captain.luffy', 'first-mate.zoro', 'combatant.yamato', 'navigator.nami'))
  })
})

describe('URL serializer', () => {
  it('writes the canonical form', () => {
    expect(serializeCrew(crew('navigator.nami', 'combatant.yamato', 'captain.luffy', 'combatant.marco')))
      .toBe('captain.luffy~combatant.marco~combatant.yamato~navigator.nami')
    expect(serializeCrew([])).toBe('')
  })

  it('round-trips through validateCrew', () => {
    const value = 'captain.luffy~first-mate.zoro~navigator.nami'
    const parsed = parseCrew(value)
    expect(parsed.malformed).toEqual([])
    expect(serializeCrew(validateCrew(ctx, parsed.placements).crew)).toBe(value)
  })

  it('collects malformed items and tolerates empty input', () => {
    expect(parseCrew('captain.luffy~zoro~a.b.c~.x').malformed).toEqual(['zoro', 'a.b.c', '.x'])
    expect(parseCrew(null)).toEqual({ placements: [], malformed: [] })
    expect(parseCrew('x'.repeat(5000)).placements).toEqual([])
  })

  it('keeps key lists in order', () => {
    expect(parseKeys(serializeKeys(['robin', 'brook']))).toEqual(['robin', 'brook'])
    expect(parseKeys('a~~b')).toEqual(['a', 'b'])
  })

  it('survives encodeURIComponent unescaped', () => {
    const value = serializeCrew(crew('captain.luffy', 'first-mate.zoro'))
    expect(encodeURIComponent(value)).toBe(value)
  })

  it('is form-encoded by URLSearchParams, so canonical checks must compare decoded values', () => {
    // ufo and Vue Router leave `~` alone; URLSearchParams writes %7E. Never build these URLs with it.
    const value = serializeCrew(crew('captain.luffy', 'first-mate.zoro'))
    const encoded = new URLSearchParams({ s: value }).toString()
    expect(encoded).toBe('s=captain.luffy%7Efirst-mate.zoro')
    expect(new URLSearchParams(encoded).get('s')).toBe(value)
  })
})
