import {
  STATS,
  checkCatalog,
  checkRules,
  createContext,
  rosterWarnings,
  validateCrew,
} from '#shared/engine'
import type { Ability, Objective, Placement, PositionKey, Problem, Rule, Stat } from '#shared/engine'
import { RULES } from '#shared/rules'
import type {
  Action,
  ActionTarget,
  Block,
  CharacterView,
  Concept,
  DerivedSnapshot,
  FeatureGridItem,
  Image,
  Lexicon,
  PageModel,
  Preset,
  RichBlock,
  RichInline,
  RichMark,
  RichText,
  SiteSettings,
  SnapshotHashes,
} from '#shared/types/content'
import { NAME_SLOTS, composeName, patternSlots } from '#shared/utils/crewName'
import { DENIED_PHRASES } from './denylist'
import {
  ACTION_TARGET_TYPES,
  BLOCK_TYPES,
  CONCEPT_FACETS,
  CONTENT_TYPES,
  HOME_SLUG,
  PRESET_SEAT_FIELDS,
  RICH_TEXT_LINK_TYPES,
  SLUG_PATTERN,
  STAT_FIELDS,
  WEIGHT_FIELDS,
} from './model'
import type { RawAsset, RawEntry, RawLink, RawSnapshot } from './raw'

// The adapter and validation gate (ARCHITECTURE.md §5.1, §10.2 step 3.3): raw snapshot →
// catalog, presets and page models, validated with this deployment's code. Strict in v1:
// any error rejects the whole snapshot and the previous one keeps serving.
//
// Expand/contract (§5.4): unknown fields and content types are ignored (a warning for types),
// so the code can deploy before a content-model change.

export interface DeriveOptions {
  rules?: readonly Rule[]
  deniedPhrases?: readonly string[]
}

export type DeriveResult =
  | { ok: true, snapshot: DerivedSnapshot, errors: [], warnings: Problem[] }
  | { ok: false, snapshot: null, errors: Problem[], warnings: Problem[] }

export function derive(raw: RawSnapshot, hashes: SnapshotHashes, options: DeriveOptions = {}): DeriveResult {
  const d = new Deriver(raw, options)
  return d.run(hashes)
}

class Deriver {
  private readonly entries = new Map<string, RawEntry>()
  private readonly assets = new Map<string, RawAsset>()
  private readonly problems: Problem[] = []
  private readonly rules: readonly Rule[]
  private readonly denied: readonly string[]

  constructor(private readonly raw: RawSnapshot, options: DeriveOptions) {
    for (const e of raw.entries) this.entries.set(e.id, e)
    for (const a of raw.assets) this.assets.set(a.id, a)
    this.rules = options.rules ?? RULES
    this.denied = options.deniedPhrases ?? DENIED_PHRASES
  }

  run(hashes: SnapshotHashes): DeriveResult {
    for (const e of this.raw.entries) {
      if (!(CONTENT_TYPES as readonly string[]).includes(e.type)) {
        this.warn('unknown-type', subjectOf(e), `Content type "${e.type}" isn't read by this code; ignored`)
      }
    }

    const concepts = this.ofType('concept').map(e => this.concept(e))
    const abilities = this.ofType('ability').map(e => this.ability(e))
    const characters = this.ofType('character').map(e => this.character(e))
    const objectives = this.ofType('objective').map(e => this.objective(e))
    const lexicon = this.lexicon(characters)
    this.uniqueKeys('concept', concepts)
    this.uniqueKeys('preset', this.ofType('crewPreset').map(e => ({ key: this.str(e, 'key') ?? '' })))

    const catalogCheck = checkCatalog({ characters, abilities, objectives })
    this.problems.push(...catalogCheck.errors, ...catalogCheck.warnings)

    // The engine context is only trustworthy once the catalog itself is valid.
    const catalogOk = catalogCheck.errors.length === 0
    const ctx = createContext({ characters, abilities, objectives }, this.rules)
    const presets = this.ofType('crewPreset').map(e => this.preset(e, catalogOk ? ctx : null))
    if (catalogOk) {
      const ruleCheck = checkRules(ctx, this.rules)
      this.problems.push(...ruleCheck.errors, ...ruleCheck.warnings)
      this.problems.push(...rosterWarnings(ctx))
    }

    const pages = this.pages()
    const settings = this.settings()

    const errors = this.problems.filter(p => p.severity === 'error')
    const warnings = this.problems.filter(p => p.severity === 'warning')
    if (errors.length > 0) return { ok: false, snapshot: null, errors, warnings }
    return {
      ok: true,
      snapshot: {
        hashes,
        catalog: { characters, abilities, objectives, presets, concepts, lexicon },
        pages,
        settings,
      },
      errors: [],
      warnings,
    }
  }

  // -------------------------------------------------------------------------
  // Catalog

  private character(e: RawEntry): CharacterView {
    const stats = Object.fromEntries(STATS.map(s => [s, this.int(e, STAT_FIELDS[s], true) ?? 0])) as Record<Stat, number>
    return {
      key: this.str(e, 'key', true) ?? e.id,
      formerKeys: this.strList(e, 'formerKeys'),
      status: (this.str(e, 'status') ?? 'active') as CharacterView['status'],
      name: this.str(e, 'name', true) ?? '',
      stats,
      roles: this.strList(e, 'roles') as CharacterView['roles'],
      powerType: (this.str(e, 'powerType', true) ?? 'none') as CharacterView['powerType'],
      faction: (this.str(e, 'faction', true) ?? 'independent') as CharacterView['faction'],
      haki: this.strList(e, 'haki') as CharacterView['haki'],
      epithet: this.str(e, 'epithet'),
      bounty: this.int(e, 'bounty'),
      portrait: this.image(e, 'portrait'),
      concepts: this.keysOf(e, 'concepts', ['concept']),
      abilities: this.keysOf(e, 'abilities', ['ability']),
    }
  }

  private ability(e: RawEntry): Ability {
    return {
      key: this.str(e, 'key', true) ?? e.id,
      name: this.str(e, 'name', true) ?? '',
      kind: (this.str(e, 'kind', true) ?? 'technique') as Ability['kind'],
    }
  }

  private objective(e: RawEntry): Objective {
    const weights: Objective['weights'] = {}
    for (const s of STATS) {
      const w = this.int(e, WEIGHT_FIELDS[s])
      if (w !== null) weights[s] = w
    }
    return {
      key: this.str(e, 'key', true) ?? e.id,
      name: this.str(e, 'name', true) ?? '',
      weights,
      requiredPositions: this.strList(e, 'requiredPositions') as PositionKey[],
    }
  }

  private concept(e: RawEntry): Concept {
    const facet = this.str(e, 'facet', true) ?? ''
    if (facet && !(CONCEPT_FACETS as readonly string[]).includes(facet)) {
      this.error('unknown-value', subjectOf(e), `Unknown facet "${facet}"`)
    }
    return {
      key: this.str(e, 'key', true) ?? e.id,
      label: this.str(e, 'label', true) ?? '',
      facet,
      synonyms: this.strList(e, 'synonyms'),
      description: this.str(e, 'description'),
    }
  }

  private preset(e: RawEntry, ctx: ReturnType<typeof createContext> | null): Preset {
    const placements: Placement[] = []
    for (const { field, position } of PRESET_SEAT_FIELDS) {
      const target = this.linkedEntry(e, field, ['character'])
      if (target) placements.push({ position, character: this.str(target, 'key') ?? target.id })
    }
    const key = this.str(e, 'key', true) ?? e.id
    let crew = placements
    if (ctx) {
      // A preset is a starting crew people save from, so it must pass the save checks.
      const validation = validateCrew(ctx, placements, { forSave: true })
      for (const issue of validation.issues) this.error(`preset-${issue.code}`, subjectOf(e), issue.message)
      crew = validation.crew
    }
    return {
      key,
      name: this.str(e, 'name', true) ?? '',
      description: this.str(e, 'description'),
      crew,
      concepts: this.keysOf(e, 'concepts', ['concept']),
    }
  }

  private lexicon(characters: readonly CharacterView[]): Lexicon {
    const settings = this.singleSettings()
    // Without exactly one settings entry there's nothing to check; that error is already reported.
    if (!settings) return { patterns: [], words: { adjective: [], noun: [] } }
    const lexicon: Lexicon = {
      patterns: this.strList(settings, 'namePatterns'),
      words: {
        adjective: this.strList(settings, 'nameAdjectives'),
        noun: this.strList(settings, 'nameNouns'),
      },
    }
    const subject = 'siteSettings lexicon'
    if (lexicon.patterns.length === 0) this.error('lexicon-empty', subject, 'At least one crew-name pattern is needed')

    // Character names never go into names (§9): "Monkey" and "Black" alone are innocent.
    const nameTokens = new Set(characters.flatMap(c => tokens(c.name)).filter(t => t.length >= 3))
    const checkTokens = (text: string, what: string) => {
      for (const t of tokens(text)) {
        if (nameTokens.has(t)) this.error('lexicon-character-name', subject, `${what} "${text}" contains the character name "${t}"`)
      }
    }

    for (const pattern of lexicon.patterns) {
      const slots = patternSlots(pattern)
      if (slots.length === 0) this.error('lexicon-pattern', subject, `Pattern "${pattern}" has no placeholders`)
      for (const s of slots) {
        if (!(NAME_SLOTS as readonly string[]).includes(s)) this.error('lexicon-pattern', subject, `Pattern "${pattern}" uses unknown placeholder {${s}}`)
        else if (lexicon.words[s as keyof Lexicon['words']].length === 0) this.error('lexicon-empty', subject, `Pattern "${pattern}" needs ${s} words`)
      }
      checkTokens(pattern.replace(/\{[a-zA-Z]+\}/g, ' '), 'Pattern')
    }
    for (const slot of NAME_SLOTS) {
      const seen = new Set<string>()
      for (const word of lexicon.words[slot]) {
        if (!/^[A-Za-z][A-Za-z' -]{0,23}$/.test(word)) this.error('lexicon-word', subject, `${slot} "${word}" must be 1–24 letters, spaces, hyphens or apostrophes`)
        // Words are keyed by their text, so duplicates would be one key.
        if (seen.has(word.toLowerCase())) this.error('lexicon-duplicate', subject, `${slot} "${word}" appears twice`)
        seen.add(word.toLowerCase())
        checkTokens(word, `The ${slot}`)
      }
    }

    // Every combination, against the phrase deny-list.
    const denied = this.denied.map(p => ` ${tokens(p).join(' ')} `)
    for (const pattern of lexicon.patterns) {
      const slots = patternSlots(pattern)
      const adjectives = slots.includes('adjective') ? lexicon.words.adjective : ['']
      const nouns = slots.includes('noun') ? lexicon.words.noun : ['']
      for (const adjective of adjectives) {
        for (const noun of nouns) {
          const name = composeName({ pattern, words: { adjective, noun } })
          const padded = ` ${tokens(name).join(' ')} `
          const hit = denied.find(d => padded.includes(d))
          if (hit) this.error('lexicon-denied', subject, `"${name}" contains a denied phrase ("${hit.trim()}")`)
        }
      }
    }
    return lexicon
  }

  // -------------------------------------------------------------------------
  // Pages

  private pages(): Record<string, PageModel> {
    const pages: Record<string, PageModel> = {}
    for (const e of this.ofType('page')) {
      const slug = this.str(e, 'slug', true) ?? ''
      if (slug && !SLUG_PATTERN.test(slug)) this.error('bad-slug', subjectOf(e), `Slug "${slug}" must be lowercase words joined by - and /`)
      if (pages[slug]) this.error('duplicate-slug', subjectOf(e), `Slug "${slug}" is used twice`)
      const blocks = this.linkedEntries(e, 'blocks', BLOCK_TYPES).map(b => this.block(b)).filter((b): b is Block => b !== null)
      if (blocks.length === 0) this.error('no-blocks', subjectOf(e), 'A page needs at least one block')
      pages[slug] = {
        slug,
        title: this.str(e, 'title', true) ?? '',
        blocks,
        concepts: this.keysOf(e, 'concepts', ['concept']),
        seo: { title: this.str(e, 'seoTitle'), description: this.str(e, 'seoDescription') },
        indexable: this.bool(e, 'indexable') ?? true,
      }
    }
    if (!pages[HOME_SLUG]) this.error('no-home', 'page', `A page with slug "${HOME_SLUG}" is needed for /`)
    return pages
  }

  private block(e: RawEntry): Block | null {
    switch (e.type) {
      case 'blockHero':
        return {
          type: 'hero',
          headline: this.str(e, 'headline', true) ?? '',
          subheadline: this.str(e, 'subheadline'),
          image: this.image(e, 'image'),
          featuredCharacter: this.keyOf(e, 'featuredCharacter', ['character']),
          action: this.action(e, false),
        }
      case 'blockFeatureGrid':
        return {
          type: 'featureGrid',
          heading: this.str(e, 'heading', true) ?? '',
          intro: this.str(e, 'intro'),
          items: this.linkedEntries(e, 'items', ['featureItem', 'character', 'ability', 'crewPreset']).map(i => this.gridItem(i)),
          action: this.action(e, false),
        }
      case 'blockCta': {
        const action = this.action(e, true)
        if (!action) return null
        return { type: 'cta', heading: this.str(e, 'heading', true) ?? '', body: this.richText(e, 'body'), action }
      }
      case 'blockTestimonial': {
        const speaker = this.keyOf(e, 'speaker', ['character'])
        const attribution = this.str(e, 'attribution')
        if ((speaker === null) === (attribution === null)) {
          this.error('testimonial-source', subjectOf(e), 'A testimonial needs exactly one of a speaker or an attribution')
        }
        return { type: 'testimonial', quote: this.str(e, 'quote', true) ?? '', speaker, attribution, context: this.str(e, 'context') }
      }
      default:
        return null
    }
  }

  private gridItem(e: RawEntry): FeatureGridItem {
    switch (e.type) {
      case 'character': return { kind: 'character', character: this.str(e, 'key') ?? e.id }
      case 'ability': return { kind: 'ability', ability: this.str(e, 'key') ?? e.id }
      case 'crewPreset': return { kind: 'preset', preset: this.str(e, 'key') ?? e.id }
      default: return { kind: 'feature', title: this.str(e, 'title', true) ?? '', body: this.str(e, 'body') ?? '', icon: this.str(e, 'icon') }
    }
  }

  /** A label plus either target references or an external URL (§5.3). */
  private action(e: RawEntry, required: boolean): Action | null {
    const label = this.str(e, 'actionLabel')
    const url = this.str(e, 'actionUrl')
    const targets = this.linkedEntries(e, 'actionTarget', ACTION_TARGET_TYPES)
    const hasTarget = targets.length > 0 || url !== null
    if (!label && !hasTarget) {
      if (required) this.error('missing-action', subjectOf(e), 'This block needs a call to action')
      return null
    }
    if (!label) {
      this.error('action-label', subjectOf(e), 'A call to action needs a label')
      return null
    }
    if (targets.length > 0 && url !== null) {
      this.error('action-target', subjectOf(e), 'Use either target entries or an external URL, not both')
      return null
    }
    if (url !== null) {
      if (!/^https:\/\/\S+$/.test(url)) this.error('action-url', subjectOf(e), `External URL "${url}" must start with https://`)
      return { label, target: { kind: 'external', url } }
    }
    if (targets.length === 0) {
      this.error('action-target', subjectOf(e), 'A call to action needs a target')
      return null
    }
    const target = this.target(e, targets)
    return target ? { label, target } : null
  }

  /** The type of the referenced entries decides the behavior. */
  private target(owner: RawEntry, targets: readonly RawEntry[]): ActionTarget | null {
    const types = new Set(targets.map(t => t.type))
    if (types.size > 1) {
      this.error('action-target', subjectOf(owner), `A target mixes ${[...types].join(' and ')}; use one kind`)
      return null
    }
    const type = targets[0]!.type
    if (type === 'character') {
      if (targets.length > 4) this.error('action-target', subjectOf(owner), 'Compare at most four characters')
      return { kind: 'compare', characters: targets.map(t => this.str(t, 'key') ?? t.id) }
    }
    if (targets.length > 1) {
      this.error('action-target', subjectOf(owner), `A ${type} target takes exactly one entry`)
      return null
    }
    const t = targets[0]!
    if (type === 'page') return { kind: 'page', slug: this.str(t, 'slug') ?? '' }
    if (type === 'crewPreset') return { kind: 'preset', preset: this.str(t, 'key') ?? '' }
    return { kind: 'objective', objective: this.str(t, 'key') ?? '' }
  }

  // -------------------------------------------------------------------------
  // Restricted Rich Text (D13)

  private richText(e: RawEntry, field: string): RichText {
    const doc = e.fields[field] as RichNode | undefined
    if (doc === undefined || doc === null) return []
    if (doc.nodeType !== 'document') {
      this.error('rich-text', subjectOf(e), `${field} isn't a Rich Text document`)
      return []
    }
    return this.richBlocks(e, field, doc.content ?? [])
  }

  private richBlocks(e: RawEntry, field: string, nodes: readonly RichNode[]): RichBlock[] {
    const out: RichBlock[] = []
    for (const node of nodes) {
      switch (node.nodeType) {
        case 'paragraph':
          out.push({ type: 'paragraph', children: this.richInlines(e, field, node.content ?? []) })
          break
        case 'heading-2':
        case 'heading-3':
          out.push({ type: 'heading', level: node.nodeType === 'heading-2' ? 2 : 3, children: this.richInlines(e, field, node.content ?? []) })
          break
        case 'unordered-list':
        case 'ordered-list':
          out.push({
            type: 'list',
            ordered: node.nodeType === 'ordered-list',
            items: (node.content ?? []).map(item => this.richBlocks(e, field, item.content ?? [])),
          })
          break
        case 'hr':
          out.push({ type: 'rule' })
          break
        default:
          this.error('rich-text-node', subjectOf(e), `${field} uses "${node.nodeType}", which restricted Rich Text doesn't allow`)
      }
    }
    return out
  }

  private richInlines(e: RawEntry, field: string, nodes: readonly RichNode[]): RichInline[] {
    const out: RichInline[] = []
    for (const node of nodes) {
      if (node.nodeType === 'text') {
        const marks: RichMark[] = []
        for (const m of node.marks ?? []) {
          if (m.type === 'bold' || m.type === 'italic') marks.push(m.type)
          else this.warn('rich-text-mark', subjectOf(e), `${field} uses the "${m.type}" mark, which is dropped`)
        }
        out.push({ type: 'text', value: node.value ?? '', marks })
      }
      else if (node.nodeType === 'entry-hyperlink') {
        const link = node.data?.target as RawLink | undefined
        const target = link ? this.resolve(e, link, RICH_TEXT_LINK_TYPES) : null
        const action = target ? this.target(e, [target]) : null
        const children = this.richInlines(e, field, node.content ?? [])
        if (action) out.push({ type: 'link', target: action, children })
        else out.push(...children)
      }
      else {
        this.error('rich-text-node', subjectOf(e), `${field} uses "${node.nodeType}", which restricted Rich Text doesn't allow`)
      }
    }
    return out
  }

  // -------------------------------------------------------------------------
  // Settings

  private singleSettings(): RawEntry | null {
    const all = this.ofType('siteSettings')
    if (all.length !== 1) {
      // Reported once, from here; settings() reuses the same entry.
      if (!this.reportedSettings) this.error('site-settings', 'siteSettings', `Exactly one siteSettings entry is needed, found ${all.length}`)
      this.reportedSettings = true
      return null
    }
    return all[0]!
  }

  private reportedSettings = false

  private settings(): SiteSettings {
    const e = this.singleSettings()
    if (!e) return { navigation: [], footer: null }
    return {
      navigation: this.linkedEntries(e, 'navigation', ['page']).map(p => ({ label: this.str(p, 'title') ?? '', slug: this.str(p, 'slug') ?? '' })),
      footer: this.str(e, 'footerText'),
    }
  }

  // -------------------------------------------------------------------------
  // Field readers. Each records a problem instead of throwing, so one run reports everything.

  private ofType(type: string): RawEntry[] {
    return this.raw.entries.filter(e => e.type === type)
  }

  private str(e: RawEntry, field: string, required = false): string | null {
    const v = e.fields[field]
    if (typeof v === 'string' && v.trim() !== '') return v
    if (v !== undefined && typeof v !== 'string') this.error('bad-field', subjectOf(e), `${field} should be text`)
    else if (required) this.error('missing-field', subjectOf(e), `${field} is required`)
    return null
  }

  private int(e: RawEntry, field: string, required = false): number | null {
    const v = e.fields[field]
    if (typeof v === 'number' && Number.isInteger(v)) return v
    if (v !== undefined) this.error('bad-field', subjectOf(e), `${field} should be a whole number`)
    else if (required) this.error('missing-field', subjectOf(e), `${field} is required`)
    return null
  }

  private bool(e: RawEntry, field: string): boolean | null {
    const v = e.fields[field]
    return typeof v === 'boolean' ? v : null
  }

  private strList(e: RawEntry, field: string): string[] {
    const v = e.fields[field]
    if (v === undefined) return []
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) {
      this.error('bad-field', subjectOf(e), `${field} should be a list of text`)
      return []
    }
    return v as string[]
  }

  private resolve(owner: RawEntry, link: RawLink, allowed: readonly string[]): RawEntry | null {
    const target = this.entries.get(link.id)
    if (!target) {
      // Unpublished, archived or deleted: the delivery API simply leaves it out (§5.3).
      this.error('broken-link', subjectOf(owner), `Links to an entry that isn't published (${link.id})`)
      return null
    }
    if (!allowed.includes(target.type)) {
      this.error('bad-link-type', subjectOf(owner), `Links to a ${target.type}; expected ${allowed.join(' or ')}`)
      return null
    }
    return target
  }

  private linkedEntry(e: RawEntry, field: string, allowed: readonly string[]): RawEntry | null {
    const v = e.fields[field] as RawLink | undefined
    if (v === undefined) return null
    if (!isLink(v, 'Entry')) {
      this.error('bad-field', subjectOf(e), `${field} should be a reference`)
      return null
    }
    return this.resolve(e, v, allowed)
  }

  private linkedEntries(e: RawEntry, field: string, allowed: readonly string[]): RawEntry[] {
    const v = e.fields[field]
    if (v === undefined) return []
    if (!Array.isArray(v) || !v.every(x => isLink(x, 'Entry'))) {
      this.error('bad-field', subjectOf(e), `${field} should be a list of references`)
      return []
    }
    return v.map(link => this.resolve(e, link as RawLink, allowed)).filter((x): x is RawEntry => x !== null)
  }

  private keyOf(e: RawEntry, field: string, allowed: readonly string[]): string | null {
    const target = this.linkedEntry(e, field, allowed)
    return target ? this.str(target, 'key') ?? target.id : null
  }

  private keysOf(e: RawEntry, field: string, allowed: readonly string[]): string[] {
    return this.linkedEntries(e, field, allowed).map(t => this.str(t, 'key') ?? t.id)
  }

  private image(e: RawEntry, field: string): Image | null {
    const v = e.fields[field] as RawLink | undefined
    if (v === undefined) return null
    if (!isLink(v, 'Asset')) {
      this.error('bad-field', subjectOf(e), `${field} should be an asset`)
      return null
    }
    const asset = this.assets.get(v.id)
    if (!asset) {
      this.error('broken-link', subjectOf(e), `${field} links to an asset that isn't published (${v.id})`)
      return null
    }
    if (!asset.contentType.startsWith('image/') || asset.width === null || asset.height === null) {
      this.error('bad-asset', subjectOf(e), `${field} must be an image`)
      return null
    }
    return { url: asset.url, title: asset.title, width: asset.width, height: asset.height }
  }

  private uniqueKeys(kind: string, items: readonly { key: string }[]) {
    const seen = new Set<string>()
    for (const { key } of items) {
      if (!key) continue
      if (seen.has(key)) this.error('duplicate-key', `${kind} ${key}`, `${kind} "${key}" appears twice`)
      seen.add(key)
    }
  }

  private error(code: string, subject: string, message: string) {
    this.problems.push({ severity: 'error', code, subject, message })
  }

  private warn(code: string, subject: string, message: string) {
    this.problems.push({ severity: 'warning', code, subject, message })
  }
}

interface RichNode {
  nodeType: string
  value?: string
  marks?: { type: string }[]
  data?: { target?: unknown }
  content?: RichNode[]
}

function isLink(v: unknown, kind: RawLink['$link']): v is RawLink {
  return !!v && typeof v === 'object' && (v as RawLink).$link === kind && typeof (v as RawLink).id === 'string'
}

function subjectOf(e: RawEntry): string {
  const key = typeof e.fields.key === 'string' ? e.fields.key : typeof e.fields.slug === 'string' ? e.fields.slug : e.id
  return `${e.type} ${key}`
}

/** Lowercase words, punctuation as separators. */
function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}
