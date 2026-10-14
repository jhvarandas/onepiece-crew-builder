import type { Character, CatalogInput, Placement } from '../engine'

// The models components render (ARCHITECTURE.md §5.1, principle 3). Contentful, code and later
// the AI all produce these; components never see Contentful's response shapes.

// ---------------------------------------------------------------------------
// Links and actions

/** Where a call to action leads. Built from the target's type (§5.3, "Calls to action are inline"). */
export type ActionTarget =
  | { kind: 'page', slug: string }
  | { kind: 'preset', preset: string }
  | { kind: 'objective', objective: string }
  | { kind: 'compare', characters: string[] }
  | { kind: 'external', url: string }

export interface Action {
  label: string
  target: ActionTarget
}

// ---------------------------------------------------------------------------
// Restricted Rich Text (D13): formatting plus links to other entries, nothing else.

export type RichMark = 'bold' | 'italic'

export type RichInline =
  | { type: 'text', value: string, marks: RichMark[] }
  | { type: 'link', target: ActionTarget, children: RichInline[] }

export type RichBlock =
  | { type: 'paragraph', children: RichInline[] }
  | { type: 'heading', level: 2 | 3, children: RichInline[] }
  | { type: 'list', ordered: boolean, items: RichBlock[][] }
  | { type: 'rule' }

export type RichText = RichBlock[]

// ---------------------------------------------------------------------------
// Assets

export interface Image {
  url: string
  title: string
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Blocks: the fixed vocabulary every page type shares.

export interface HeroBlock {
  type: 'hero'
  headline: string
  subheadline: string | null
  image: Image | null
  featuredCharacter: string | null
  action: Action | null
}

export type FeatureGridItem =
  | { kind: 'feature', title: string, body: string, icon: string | null }
  | { kind: 'character', character: string }
  | { kind: 'ability', ability: string }
  | { kind: 'preset', preset: string }

export interface FeatureGridBlock {
  type: 'featureGrid'
  heading: string
  intro: string | null
  items: FeatureGridItem[]
  action: Action | null
}

export interface CtaBlock {
  type: 'cta'
  heading: string
  body: RichText
  action: Action
}

export interface TestimonialBlock {
  type: 'testimonial'
  quote: string
  /** A character key, or null when attributed by text. */
  speaker: string | null
  attribution: string | null
  context: string | null
}

export type Block = HeroBlock | FeatureGridBlock | CtaBlock | TestimonialBlock

// ---------------------------------------------------------------------------
// Pages and settings

export interface PageModel {
  slug: string
  title: string
  blocks: Block[]
  concepts: string[]
  seo: { title: string | null, description: string | null }
  indexable: boolean
}

export interface SiteSettings {
  navigation: { label: string, slug: string }[]
  footer: string | null
}

// ---------------------------------------------------------------------------
// Catalog views: the engine's types plus what pages show.

export interface CharacterView extends Character {
  epithet: string | null
  bounty: number | null
  portrait: Image | null
  concepts: string[]
  abilities: string[]
}

export interface Preset {
  key: string
  name: string
  description: string | null
  crew: Placement[]
  concepts: string[]
}

export interface Concept {
  key: string
  label: string
  facet: string
  synonyms: string[]
  description: string | null
}

/** Crew-name patterns and words (§9). Words are keyed by their text. */
export interface Lexicon {
  patterns: string[]
  words: { adjective: string[], noun: string[] }
}

export interface Catalog extends CatalogInput {
  characters: CharacterView[]
  presets: Preset[]
  concepts: Concept[]
  lexicon: Lexicon
}

// ---------------------------------------------------------------------------
// The derived snapshot: one deployment's view of one raw snapshot (§10.1).

export interface SnapshotHashes {
  /** The whole raw snapshot. */
  raw: string
  /** What the engine reads: characters, abilities, presets, objectives, the lexicon and their assets. */
  catalog: string
  /** Journey pages, blocks, concepts and site settings. */
  pages: string
}

export interface DerivedSnapshot {
  hashes: SnapshotHashes
  catalog: Catalog
  pages: Record<string, PageModel>
  settings: SiteSettings
}
