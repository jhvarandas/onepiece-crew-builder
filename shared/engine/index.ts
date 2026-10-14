// The compound-powers engine: pure TypeScript, deterministic, integers only.
// Import explicitly as `#shared/engine`. Nothing here may import a framework or vendor
// package (enforced by eslint.config.mjs). See ARCHITECTURE.md §6.

export * from './vocab'
export * from './positions'
export type * from './types'
export { ENGINE_VERSION } from './version'
export { createContext, resolveKey, getCharacter, getObjective, EngineError } from './context'
export type { EngineContext, RuleIndex } from './context'
export { canonicalize, validateCrew, place, replace, move, remove, occupants, positionOf, hasRoom } from './crew'
export type { ValidateOptions, Validation } from './crew'
export { evaluate, emptyStats, baseContribution, fitOf } from './evaluate'
export { diff, explain, score, compareScores, compareCandidates, rank, placementGrid, pairsFromRules } from './analysis'
export type { Diff, Contribution, Score, Target, CandidateResult, RankedCandidate, GridCell, RulePair } from './analysis'
export { complete, improve } from './search'
export type { Pin, SearchOptions, SearchResult, Step, StepKind } from './search'
export { checkCatalog, checkRules, rosterWarnings } from './checks'
export type { Problem, CheckResult } from './checks'
export { serializeCrew, parseCrew, serializeKeys, parseKeys } from './serialize'
export type { ParsedCrew } from './serialize'
