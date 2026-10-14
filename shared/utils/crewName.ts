// Generated crew names (ARCHITECTURE.md §9): "The {adjective} {noun} Pirates".
// The browser composes a draft's name for display; the server composes the saved name from
// the same recipe against the live lexicon, so no free text is ever stored.

export const NAME_SLOTS = ['adjective', 'noun'] as const
export type NameSlot = (typeof NAME_SLOTS)[number]

export interface NameRecipe {
  pattern: string
  words: Partial<Record<NameSlot, string>>
}

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g

/** The slots a pattern uses, in order; unknown placeholders are returned too so validation can flag them. */
export function patternSlots(pattern: string): string[] {
  return [...pattern.matchAll(PLACEHOLDER)].map(m => m[1]!)
}

export function composeName(recipe: NameRecipe): string {
  return recipe.pattern.replace(PLACEHOLDER, (_, slot: string) => recipe.words[slot as NameSlot] ?? `{${slot}}`)
}
