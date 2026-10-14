import { DEVIL_FRUIT_POWER_TYPES } from '../engine/vocab'
import type { Rule } from '../engine/types'

// Synergy rules for v1: typed data in code (ARCHITECTURE.md §7, decided 2026-10-14).
// Shaped like what a Contentful adapter would emit, so moving instances to Contentful later
// is an export script, not a redesign. Character and ability keys are checked against the
// catalog in CI and again whenever a snapshot is validated.

export const WORST_GENERATION = [
  'luffy',
  'zoro',
  'law',
  'kid',
  'killer',
  'hawkins',
  'drake',
  'bonney',
  'apoo',
  'urouge',
  'bege',
  'blackbeard',
]

export const RULES: Rule[] = [
  {
    key: 'monster-trio',
    name: 'Monster Trio',
    conditions: [
      { kind: 'character', character: 'luffy', position: 'any' },
      { kind: 'character', character: 'zoro', position: 'any' },
      { kind: 'character', character: 'sanji', position: 'any' },
    ],
    effects: [{ op: 'add', stat: 'combat', amount: 6, scope: 'crew' }],
    unlocks: 'monster-trio',
  },
  {
    key: 'hopelessly-lost',
    name: 'Hopelessly Lost',
    conditions: [{ kind: 'character', character: 'zoro', position: 'navigator' }],
    effects: [{ op: 'cap', stat: 'navigation', amount: 0, scope: 'navigator' }],
    unlocks: null,
  },
  {
    key: 'king-and-swordsman',
    name: 'King and Swordsman',
    conditions: [
      { kind: 'character', character: 'luffy', position: 'captain' },
      { kind: 'character', character: 'zoro', position: 'first-mate' },
    ],
    effects: [],
    unlocks: 'king-and-swordsman',
  },
  {
    key: 'brothers',
    name: 'Brothers',
    conditions: [
      { kind: 'character', character: 'luffy', position: 'captain' },
      { kind: 'character', character: 'ace', position: 'any' },
    ],
    effects: [{ op: 'add', stat: 'leadership', amount: 5, scope: 'captain' }],
    unlocks: null,
  },
  {
    key: 'cant-swim',
    name: 'Can\'t Swim',
    conditions: [
      { kind: 'attribute', attribute: 'powerType', values: [...DEVIL_FRUIT_POWER_TYPES], position: 'helmsman', atLeast: 1 },
    ],
    effects: [{ op: 'add', stat: 'helm', amount: -4, scope: 'helmsman' }],
    unlocks: null,
  },
  {
    key: 'supernovas',
    name: 'Supernovas',
    conditions: [{ kind: 'anyOf', characters: WORST_GENERATION, atLeast: 3 }],
    effects: [{ op: 'add', stat: 'combat', amount: 3, scope: 'crew' }],
    unlocks: null,
  },
]
