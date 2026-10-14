import type { EngineContext } from './context'
import { getCharacter, getObjective } from './context'
import { place, replace } from './crew'
import { attributeValues, emptyStats, evaluate } from './evaluate'
import type { PositionKey } from './positions'
import { POSITIONS } from './positions'
import type { Crew, Evaluation, Objective, Placement, StatLine } from './types'
import { STATS } from './vocab'

// Diffs, leave-one-out explanations, objective scores, ranking and rule pairs
// (ARCHITECTURE.md §6.3, §6.5, §6.6).

export interface Diff {
  /** after − before, per stat. */
  stats: StatLine
  unlocksGained: string[]
  unlocksLost: string[]
  rulesGained: string[]
  rulesLost: string[]
  added: Placement[]
  removed: Placement[]
  moved: { character: string, from: PositionKey, to: PositionKey }[]
}

export function diff(before: Evaluation, after: Evaluation): Diff {
  const stats = emptyStats()
  for (const s of STATS) stats[s] = after.totals[s] - before.totals[s]
  const beforeAt = new Map(before.crew.map(p => [p.character, p.position]))
  const afterAt = new Map(after.crew.map(p => [p.character, p.position]))
  const ruleKeys = (e: Evaluation) => e.rules.map(r => r.key)
  return {
    stats,
    unlocksGained: minus(after.unlocks, before.unlocks),
    unlocksLost: minus(before.unlocks, after.unlocks),
    rulesGained: minus(ruleKeys(after), ruleKeys(before)),
    rulesLost: minus(ruleKeys(before), ruleKeys(after)),
    added: after.crew.filter(p => !beforeAt.has(p.character)),
    removed: before.crew.filter(p => !afterAt.has(p.character)),
    moved: after.crew
      .filter(p => beforeAt.has(p.character) && beforeAt.get(p.character) !== p.position)
      .map(p => ({ character: p.character, from: beforeAt.get(p.character)!, to: p.position })),
  }
}

export interface Contribution {
  character: string
  position: PositionKey
  /** What the crew loses without them: full − without, per stat. */
  stats: StatLine
  unlocks: string[]
  rules: string[]
}

/** Leave-one-out: what each member adds, independent of the order the crew was built in. */
export function explain(ctx: EngineContext, crew: Crew): Contribution[] {
  const full = evaluate(ctx, crew)
  return full.crew.map((member) => {
    const without = evaluate(ctx, full.crew.filter(p => p.character !== member.character))
    const d = diff(without, full)
    return { character: member.character, position: member.position, stats: d.stats, unlocks: d.unlocksGained, rules: d.rulesGained }
  })
}

export interface Score {
  objective: string
  score: number
  /** Required positions left empty. */
  missing: PositionKey[]
}

/** Weighted sum of totals under an objective lens. Without a lens there is nothing honest to score. */
export function score(evaluation: Evaluation, objective: Objective): Score {
  let total = 0
  for (const s of STATS) total += (objective.weights[s] ?? 0) * evaluation.totals[s]
  const missing = objective.requiredPositions.filter(position =>
    !evaluation.coverage.some(c => c.position === position && c.filled > 0))
  return { objective: objective.key, score: total, missing }
}

/** Fewer missing required positions first, then higher score. Negative means a is better. */
export function compareScores(a: Score, b: Score): number {
  return a.missing.length - b.missing.length || b.score - a.score
}

export interface Target {
  position: PositionKey
  /** For a full multi-seat position: whom the candidate replaces. */
  replacing?: string
}

export interface CandidateResult {
  character: string
  crew: Placement[]
  evaluation: Evaluation
  /** Against the crew without any candidate in the target seat. */
  diff: Diff
}

/** Each candidate in the same seat, in the order given. No ranking: compare without a lens (§6.6). */
export function compareCandidates(ctx: EngineContext, crew: Crew, target: Target, candidates: readonly string[]): CandidateResult[] {
  const current = evaluate(ctx, crew)
  return candidates.map((character) => {
    const next = target.replacing
      ? replace(ctx, crew, target.replacing, character)
      : place(ctx, crew, target.position, character)
    const evaluation = evaluate(ctx, next)
    return { character: getCharacter(ctx, character).key, crew: evaluation.crew, evaluation, diff: diff(current, evaluation) }
  })
}

export interface RankedCandidate extends CandidateResult {
  score: Score
}

/** Candidates in one seat, ordered under an objective lens; ties go by key. */
export function rank(
  ctx: EngineContext,
  crew: Crew,
  target: Target,
  candidates: readonly string[],
  objectiveKey: string,
): RankedCandidate[] {
  const objective = getObjective(ctx, objectiveKey)
  return compareCandidates(ctx, crew, target, candidates)
    .map(c => ({ ...c, score: score(c.evaluation, objective) }))
    .sort((a, b) => compareScores(a.score, b.score) || (a.character < b.character ? -1 : 1))
}

export interface GridCell {
  character: string
  position: PositionKey
  /** null when the position is a full multi-seat position. */
  score: number | null
}

/** The candidate × position heatmap shown in compare under a lens (§6.6). */
export function placementGrid(ctx: EngineContext, crew: Crew, candidates: readonly string[], objectiveKey: string): GridCell[] {
  const objective = getObjective(ctx, objectiveKey)
  const cells: GridCell[] = []
  for (const character of candidates) {
    const without = crew.filter(p => p.character !== character)
    for (const def of POSITIONS) {
      const full = without.filter(p => p.position === def.key).length >= def.capacity
      if (full && def.capacity > 1) {
        cells.push({ character, position: def.key, score: null })
        continue
      }
      const next = place(ctx, without, def.key, character)
      cells.push({ character, position: def.key, score: score(evaluate(ctx, next), objective).score })
    }
  }
  return cells
}

export interface RulePair {
  rule: string
  name: string
  /** Both characters are named by the rule, or both satisfy one of its attribute conditions. */
  reason: 'named' | 'shared-attribute'
}

/** Pairs come from the rule index, never from brute-force search (§6.6). */
export function pairsFromRules(ctx: EngineContext, a: string, b: string): RulePair[] {
  const ca = getCharacter(ctx, a)
  const cb = getCharacter(ctx, b)
  const pairs: RulePair[] = []
  const namedB = new Set(ctx.ruleIndex.byCharacter.get(cb.key) ?? [])
  for (const rule of ctx.ruleIndex.byCharacter.get(ca.key) ?? []) {
    if (namedB.has(rule)) pairs.push({ rule: rule.key, name: rule.name, reason: 'named' })
  }
  for (const rule of ctx.ruleIndex.byAttribute) {
    if (pairs.some(p => p.rule === rule.key)) continue
    const shared = rule.conditions.some((c) => {
      if (c.kind !== 'attribute' || c.atLeast < 2) return false
      const values = c.values as readonly string[]
      const matches = (attr: readonly string[]) => attr.some(v => values.includes(v))
      return matches(attributeValues(ca, c.attribute)) && matches(attributeValues(cb, c.attribute))
    })
    if (shared) pairs.push({ rule: rule.key, name: rule.name, reason: 'shared-attribute' })
  }
  return pairs.sort((x, y) => (x.rule < y.rule ? -1 : 1))
}

function minus(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b)
  return [...new Set(a.filter(x => !set.has(x)))].sort()
}
