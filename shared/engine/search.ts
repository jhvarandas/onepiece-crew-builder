import { compareScores, diff, score } from './analysis'
import type { Diff, Score } from './analysis'
import type { EngineContext } from './context'
import { EngineError, getCharacter, getObjective, resolveKey } from './context'
import { canonicalize, hasRoom } from './crew'
import { evaluate } from './evaluate'
import type { PositionKey } from './positions'
import { POSITIONS, isPositionKey, positionDef, positionOrder } from './positions'
import type { Crew, Evaluation, Objective, Placement, StatLine } from './types'
import { STATS } from './vocab'

// Search as an assignment problem (ARCHITECTURE.md §6.5): greedy moves with recorded
// reasons, pair moves from the rule index, one swap pass. Deterministic; ties go by key.
// Runs in a Web Worker in the browser; on the server only behind the AI route's limits.

export interface Pin {
  character: string
  /** A position, or `any` to let the search choose. */
  position: PositionKey | 'any'
}

export interface SearchOptions {
  /** Must be in the result. */
  pins?: readonly Pin[]
  /** Never placed. */
  exclusions?: readonly string[]
  /** If given, only these characters are candidates (roster filters resolve to a pool). */
  pool?: readonly string[]
}

export type StepKind = 'pin' | 'place' | 'pair' | 'replace' | 'swap'

export interface Step {
  kind: StepKind
  /** The placements this step made, canonical. */
  placements: Placement[]
  /** Characters this step took out of the crew (replace only). */
  removed: string[]
  diff: Diff
  scoreBefore: Score
  scoreAfter: Score
  /** A plain-English reason, e.g. "Nami → Navigator: +40 navigation". */
  reason: string
}

export interface SearchResult {
  crew: Placement[]
  score: Score
  steps: Step[]
}

/** Pair moves are only tried for rules naming at most this many characters, to bound the work. */
const MAX_PAIR_RULE_SIZE = 6

/**
 * Fills empty seats greedily under an objective. Never changes placements already in the crew.
 * A move places one character, or a pair that completes a rule; pairs compete on gain per seat.
 */
export function complete(ctx: EngineContext, crew: Crew, objectiveKey: string, options: SearchOptions = {}): SearchResult {
  const objective = getObjective(ctx, objectiveKey)
  const locked = new Set(crew.map(p => p.character))
  let current = canonicalize(crew)
  const steps: Step[] = []

  for (const pin of options.pins ?? []) {
    const key = resolveKey(ctx, pin.character)
    if (!key) throw new EngineError(`Unknown pinned character "${pin.character}"`)
    locked.add(key)
    if (current.some(p => p.character === key && (pin.position === 'any' || p.position === pin.position))) continue
    if (current.some(p => p.character === key)) {
      throw new EngineError(`${getCharacter(ctx, key).name} is pinned to ${pin.position} but already sits elsewhere`)
    }
    const positions = pin.position === 'any' ? openPositions(current) : [pin.position]
    if (pin.position !== 'any' && !hasRoom(current, pin.position)) {
      throw new EngineError(`${getCharacter(ctx, key).name} is pinned to a full position`)
    }
    const base = baseOf(ctx, objective, current)
    const best = bestOf(positions.map(position => candidateMove(ctx, objective, base, 'pin', [{ position, character: key }])))
    if (!best) throw new EngineError('No open position for a pin')
    steps.push(toStep(ctx, base, best))
    current = best.crew
  }

  const candidates = candidatePool(ctx, options).filter(k => !current.some(p => p.character === k))
  const used = new Set(current.map(p => p.character))

  for (;;) {
    const open = openPositions(current)
    if (open.length === 0) break
    const base = baseOf(ctx, objective, current)
    const moves: Move[] = []
    for (const character of candidates) {
      if (used.has(character)) continue
      for (const position of open) moves.push(candidateMove(ctx, objective, base, 'place', [{ position, character }]))
    }
    if (open.length >= 2) moves.push(...pairMoves(ctx, objective, base, candidates, used))
    const best = bestOf(moves.filter(improves))
    if (!best) break
    steps.push(toStep(ctx, base, best))
    current = best.crew
    for (const p of best.additions) used.add(p.character)
  }

  const swapped = swapPass(ctx, objective, current, locked, candidates)
  steps.push(...swapped.steps)
  current = swapped.crew

  return { crew: current, score: score(evaluate(ctx, current), objective), steps }
}

/** Runs the swap pass on a crew as it stands, so a full crew can still get better (§6.5). */
export function improve(ctx: EngineContext, crew: Crew, objectiveKey: string, options: SearchOptions = {}): SearchResult {
  const objective = getObjective(ctx, objectiveKey)
  const locked = new Set<string>()
  for (const pin of options.pins ?? []) {
    const key = resolveKey(ctx, pin.character)
    if (key) locked.add(key)
  }
  const result = swapPass(ctx, objective, canonicalize(crew), locked, candidatePool(ctx, options))
  return { crew: result.crew, score: score(evaluate(ctx, result.crew), objective), steps: result.steps }
}

// ---------------------------------------------------------------------------

interface Move {
  kind: StepKind
  additions: Placement[]
  removed: string[]
  crew: Placement[]
  scoreBefore: Score
  scoreAfter: Score
  /** Ordering key for deterministic tie-breaks. */
  signature: string
  seats: number
}

function candidatePool(ctx: EngineContext, options: SearchOptions): string[] {
  const excluded = new Set((options.exclusions ?? []).map(k => resolveKey(ctx, k) ?? k))
  const pool = options.pool
    ? new Set(options.pool.map(k => resolveKey(ctx, k)).filter((k): k is string => k !== null))
    : null
  return ctx.activeKeys.filter(k => !excluded.has(k) && (!pool || pool.has(k)))
}

function openPositions(crew: Crew): PositionKey[] {
  return POSITIONS.filter(def => hasRoom(crew, def.key)).map(def => def.key)
}

/** The crew before a batch of moves, evaluated once. */
interface Base {
  crew: Placement[]
  evaluation: Evaluation
  score: Score
}

function baseOf(ctx: EngineContext, objective: Objective, crew: Placement[]): Base {
  const evaluation = evaluate(ctx, crew)
  return { crew, evaluation, score: score(evaluation, objective) }
}

function candidateMove(
  ctx: EngineContext,
  objective: Objective,
  base: Base,
  kind: StepKind,
  additions: Placement[],
  removed: string[] = [],
): Move {
  const crew = canonicalize([...base.crew.filter(p => !removed.includes(p.character)), ...additions])
  const placements = canonicalize(additions)
  return {
    kind,
    additions: placements,
    removed,
    crew,
    scoreBefore: base.score,
    scoreAfter: score(evaluate(ctx, crew), objective),
    signature: placements.map(p => `${String(positionOrder(p.position)).padStart(2, '0')}:${p.character}`).join('|'),
    seats: Math.max(1, additions.length),
  }
}

/** Builds the recorded step for a chosen move. */
function toStep(ctx: EngineContext, base: Base, move: Move): Step {
  const d = diff(base.evaluation, evaluate(ctx, move.crew))
  return {
    kind: move.kind,
    placements: move.additions,
    removed: move.removed,
    diff: d,
    scoreBefore: move.scoreBefore,
    scoreAfter: move.scoreAfter,
    reason: describe(ctx, move.kind, move.additions, move.removed, d.stats, d.unlocksGained),
  }
}

/** Placing a pair that completes a rule, for rules where neither is in the crew yet. */
function pairMoves(ctx: EngineContext, objective: Objective, base: Base, candidates: readonly string[], used: ReadonlySet<string>): Move[] {
  const allowed = new Set(candidates)
  const moves: Move[] = []
  const seen = new Set<string>()
  for (const rule of ctx.rules) {
    const named = [...new Set(rule.conditions.flatMap(c =>
      c.kind === 'character' ? [c.character] : c.kind === 'anyOf' ? c.characters : []))]
    if (named.length < 2 || named.length > MAX_PAIR_RULE_SIZE) continue
    const missing = named.filter(k => !used.has(k) && allowed.has(k))
    for (let i = 0; i < missing.length; i++) {
      for (let j = i + 1; j < missing.length; j++) {
        const [a, b] = [missing[i]!, missing[j]!].sort() as [string, string]
        if (seen.has(`${a}+${b}`)) continue
        seen.add(`${a}+${b}`)
        for (const pa of openPositions(base.crew)) {
          const withA = [...base.crew, { position: pa, character: a }]
          for (const pb of openPositions(withA)) {
            moves.push(candidateMove(ctx, objective, base, 'pair', [{ position: pa, character: a }, { position: pb, character: b }]))
          }
        }
      }
    }
  }
  return moves
}

function improves(move: Move): boolean {
  return compareScores(move.scoreAfter, move.scoreBefore) < 0
}

/** Best by: fewer missing required positions, then score gain per seat used, then signature. */
function bestOf(moves: readonly Move[]): Move | null {
  let best: Move | null = null
  for (const move of moves) {
    if (!best || better(move, best)) best = move
  }
  return best
}

function better(a: Move, b: Move): boolean {
  // Required positions filled per seat, then score gain per seat. Per seat, so a pair that
  // fills two required positions with two poor fits can't beat the right single placement.
  // Cross-multiplied to avoid division: gainA / seatsA > gainB / seatsB.
  const filledA = (a.scoreBefore.missing.length - a.scoreAfter.missing.length) * b.seats
  const filledB = (b.scoreBefore.missing.length - b.scoreAfter.missing.length) * a.seats
  if (filledA !== filledB) return filledA > filledB
  const gainA = (a.scoreAfter.score - a.scoreBefore.score) * b.seats
  const gainB = (b.scoreAfter.score - b.scoreBefore.score) * a.seats
  if (gainA !== gainB) return gainA > gainB
  return a.signature < b.signature
}

/**
 * One pass over unlocked members in canonical order. For each, apply the best improving
 * change: replace them with an unused candidate, or swap seats with another unlocked member.
 */
function swapPass(
  ctx: EngineContext,
  objective: Objective,
  crew: Placement[],
  locked: ReadonlySet<string>,
  candidates: readonly string[],
): { crew: Placement[], steps: Step[] } {
  let current = crew
  const steps: Step[] = []
  for (const member of crew.map(p => p.character)) {
    if (locked.has(member)) continue
    const seat = current.find(p => p.character === member)
    if (!seat) continue
    const inCrew = new Set(current.map(p => p.character))
    const base = baseOf(ctx, objective, current)
    const moves: Move[] = []
    for (const candidate of candidates) {
      if (inCrew.has(candidate)) continue
      moves.push(candidateMove(ctx, objective, base, 'replace', [{ position: seat.position, character: candidate }], [member]))
    }
    for (const other of current) {
      if (other.character === member || locked.has(other.character) || other.position === seat.position) continue
      moves.push(candidateMove(ctx, objective, base, 'swap', [
        { position: other.position, character: member },
        { position: seat.position, character: other.character },
      ], [member, other.character]))
    }
    const best = bestOf(moves.filter(improves))
    if (!best) continue
    steps.push(toStep(ctx, base, best))
    current = best.crew
  }
  return { crew: current, steps }
}

function describe(
  ctx: EngineContext,
  kind: StepKind,
  placements: readonly Placement[],
  removed: readonly string[],
  stats: StatLine,
  unlocks: readonly string[],
): string {
  const name = (key: string) => getCharacter(ctx, key).name
  const label = (position: string) => (isPositionKey(position) ? positionDef(position).label : position)
  const what = kind === 'swap'
    ? `${name(placements[0]!.character)} ⇄ ${name(placements[1]!.character)}`
    : kind === 'replace'
      ? `${name(placements[0]!.character)} replaces ${name(removed[0]!)} at ${label(placements[0]!.position)}`
      : placements.map(p => `${name(p.character)} → ${label(p.position)}`).join(', ')
  const changes = STATS.filter(s => stats[s] !== 0).map(s => `${stats[s] > 0 ? '+' : ''}${stats[s]} ${s}`)
  for (const ability of unlocks) changes.push(`unlocks ${ctx.abilities.get(ability)?.name ?? ability}`)
  return changes.length ? `${what}: ${changes.join(', ')}` : what
}
