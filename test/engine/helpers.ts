import { createContext } from '#shared/engine'
import type { Crew, EngineContext, Placement, PositionKey, Rule } from '#shared/engine'
import { RULES } from '#shared/rules'
import { catalog } from '../fixtures/catalog'

export function context(rules: readonly Rule[] = RULES): EngineContext {
  return createContext(catalog, rules)
}

/** Shorthand: crew('captain.luffy', 'first-mate.zoro'). */
export function crew(...items: string[]): Placement[] {
  return items.map((item) => {
    const [position, character] = item.split('.') as [PositionKey, string]
    return { position, character }
  })
}

/** Deterministic Fisher–Yates with a small LCG, so failures reproduce. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function asCrew(placements: readonly { position: string, character: string }[]): Crew {
  return placements as Crew
}
