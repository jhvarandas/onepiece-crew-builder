import { describe, expect, it } from 'vitest'
import { canonicalize } from '#shared/engine'
import type { Rule } from '#shared/engine'
import { buildSnapshot, deriveFromBytes } from '../../server/content/snapshot'
import type { DeriveOptions } from '../../server/content/derive'
import { catalog, strawHats } from '../fixtures/catalog'
import { entry, ids, link, spaceFixture, withEntry } from '../fixtures/space'
import { shuffle } from '../engine/helpers'

const build = (space = spaceFixture(), options?: DeriveOptions) => buildSnapshot(space, 'en-US', options)

async function errorsOf(space: ReturnType<typeof spaceFixture>, options?: DeriveOptions) {
  const { result } = await build(space, options)
  expect(result.ok).toBe(false)
  return result.errors.map(e => e.code)
}

describe('derive: the fixture space', () => {
  it('produces the catalog the engine expects', async () => {
    const { result } = await build()
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    const snapshot = result.snapshot!
    const engineFields = snapshot.catalog.characters.map(({ key, formerKeys, status, name, stats, roles, powerType, faction, haki }) =>
      ({ key, formerKeys, status, name, stats, roles, powerType, faction, haki }))
    expect(engineFields).toEqual([...catalog.characters].sort((a, b) => (a.key < b.key ? -1 : 1)).map(c => expect.objectContaining(c)))
    expect(snapshot.catalog.objectives).toEqual(expect.arrayContaining(catalog.objectives))
    expect(snapshot.catalog.abilities).toEqual(expect.arrayContaining(catalog.abilities))
  })

  it('reads presets as canonical crews, and catalog extras', async () => {
    const { catalog: c } = (await build()).result.snapshot!
    expect(c.presets).toEqual([{ key: 'straw-hats', name: 'Straw Hat Pirates', description: null, crew: canonicalize(strawHats), concepts: [] }])
    const luffy = c.characters.find(ch => ch.key === 'luffy')!
    expect(luffy.portrait).toEqual({ url: 'https://images.ctfassets.net/x/luffy.png', title: 'Luffy', width: 800, height: 1000 })
    expect(luffy.abilities).toEqual(['gomu-gomu'])
    expect(c.lexicon.patterns).toEqual(['The {adjective} {noun} Pirates', '{noun} Crew'])
    expect(c.concepts).toEqual([{ key: 'wano', label: 'Wano', facet: 'arc', synonyms: ['Land of Wano'], description: null }])
  })

  it('builds page models with resolved actions and restricted Rich Text', async () => {
    const { pages, settings } = (await build()).result.snapshot!
    const home = pages.index!
    expect(home.blocks.map(b => b.type)).toEqual(['hero', 'featureGrid', 'cta', 'testimonial'])
    const [hero, grid, cta, quote] = home.blocks
    expect(hero).toMatchObject({ featuredCharacter: 'luffy', action: { label: 'Start with the Straw Hats', target: { kind: 'preset', preset: 'straw-hats' } } })
    expect(grid).toMatchObject({
      items: [{ kind: 'character', character: 'zoro' }, { kind: 'feature', title: 'Compare' }, { kind: 'ability', ability: 'monster-trio' }],
      action: { target: { kind: 'compare', characters: ['zoro', 'sanji'] } },
    })
    expect(cta).toMatchObject({
      action: { target: { kind: 'objective', objective: 'grand-line' } },
      body: [{
        type: 'paragraph',
        children: [
          { type: 'text', value: 'You need a ', marks: [] },
          { type: 'text', value: 'navigator', marks: ['bold'] },
          { type: 'text', value: ' like ', marks: [] },
          { type: 'link', target: { kind: 'compare', characters: ['nami'] }, children: [{ type: 'text', value: 'Nami', marks: [] }] },
          { type: 'text', value: '.', marks: [] },
        ],
      }],
    })
    expect(quote).toMatchObject({ speaker: 'luffy', attribution: null })
    expect(home.concepts).toEqual(['wano'])
    expect(settings).toEqual({ navigation: [{ label: 'Home', slug: 'index' }], footer: 'A learning sandbox.' })
  })

  it('reports thin positions as warnings, not errors', async () => {
    const { result } = await build()
    expect(result.warnings.map(w => w.code)).toContain('thin-position')
  })
})

describe('hashes', () => {
  it('ignore entry order, field order and republishing', async () => {
    const space = spaceFixture()
    const base = (await build(space)).hashes
    const reordered = {
      ...space,
      entries: shuffle(space.entries, 3).map(e => ({
        ...e,
        sys: { ...e.sys, revision: (e.sys.revision ?? 1) + 4 },
        fields: Object.fromEntries(shuffle(Object.entries(e.fields ?? {}), 5)),
      })),
    }
    expect((await build(reordered)).hashes).toEqual(base)
  })

  it('split into catalog and pages, so copy edits leave catalog caches alone', async () => {
    const space = spaceFixture()
    const base = (await build(space)).hashes
    const copyEdit = (await build(withEntry(space, 'bl-hero', { headline: 'Assemble your crew' }))).hashes
    expect(copyEdit.raw).not.toBe(base.raw)
    expect(copyEdit.pages).not.toBe(base.pages)
    expect(copyEdit.catalog).toBe(base.catalog)

    const footer = (await build(withEntry(space, 'ss-main', { footerText: 'Changed.' }))).hashes
    expect([footer.catalog, footer.pages !== base.pages]).toEqual([base.catalog, true])

    const statChange = (await build(withEntry(space, ids.character('zoro'), { statCombat: 93 }))).hashes
    expect([statChange.catalog !== base.catalog, statChange.pages]).toEqual([true, base.pages])

    const lexicon = (await build(withEntry(space, 'ss-main', { nameNouns: ['Anchor'] }))).hashes
    expect([lexicon.catalog !== base.catalog, lexicon.pages]).toEqual([true, base.pages])
  })

  it('derive from stored bytes, refusing bytes that don\'t match their hash', async () => {
    const built = await build()
    expect((await deriveFromBytes(built.bytes, built.hashes.raw)).ok).toBe(true)
    const tampered = new TextEncoder().encode(new TextDecoder().decode(built.bytes).replace('Build your crew', 'Build your krew'))
    await expect(deriveFromBytes(tampered, built.hashes.raw)).rejects.toThrow(/hash/)
  })
})

describe('validation gate (strict)', () => {
  const space = spaceFixture()

  it('rejects broken links, such as a preset seat pointing at an unpublished character', async () => {
    expect(await errorsOf(withEntry(space, 'cp-straw-hats', { musician: link('ch-unpublished') }))).toContain('broken-link')
  })

  it('rejects presets that aren\'t valid crews', async () => {
    const noCaptain = { ...space, entries: space.entries.map(e => (e.sys.id === 'cp-straw-hats' ? { ...e, fields: { ...e.fields, captain: undefined } } : e)) }
    expect(await errorsOf(JSON.parse(JSON.stringify(noCaptain)))).toEqual(['preset-missing-captain'])
    expect(await errorsOf(withEntry(space, 'cp-straw-hats', { captain: link(ids.character('kuro')) }))).toContain('preset-retired-character')
  })

  it('rejects bad calls to action', async () => {
    expect(await errorsOf(withEntry(space, 'bl-hero', { actionTarget: [link('cp-straw-hats'), link(ids.character('zoro'))] }))).toEqual(['action-target'])
    expect(await errorsOf(withEntry(space, 'bl-hero', { actionTarget: undefined, actionUrl: undefined }))).toEqual(['action-target'])
    expect(await errorsOf(withEntry(space, 'bl-hero', { actionUrl: 'https://example.com' }))).toEqual(['action-target'])
    expect(await errorsOf(withEntry(space, 'bl-cta', { actionLabel: undefined, actionTarget: undefined }))).toEqual(['missing-action'])
  })

  it('rejects a testimonial with both a speaker and an attribution', async () => {
    expect(await errorsOf(withEntry(space, 'bl-quote', { attribution: 'A fan' }))).toEqual(['testimonial-source'])
  })

  it('rejects Rich Text outside the restricted set', async () => {
    const body = { nodeType: 'document', data: {}, content: [{ nodeType: 'paragraph', data: {}, content: [{ nodeType: 'hyperlink', data: { uri: 'https://x' }, content: [] }] }] }
    expect(await errorsOf(withEntry(space, 'bl-cta', { body }))).toEqual(['rich-text-node'])
  })

  it('rejects lexicon words built from character names, and denied combinations', async () => {
    expect(await errorsOf(withEntry(space, 'ss-main', { nameNouns: ['Luffy'] }))).toEqual(['lexicon-character-name'])
    const denied = await errorsOf(withEntry(space, 'ss-main', { namePatterns: ['{adjective} {noun}'], nameAdjectives: ['White'], nameNouns: ['Power'] }))
    expect(denied).toEqual(['lexicon-denied'])
    expect(await errorsOf(withEntry(space, 'ss-main', { namePatterns: ['The {colour} Pirates'] }))).toEqual(['lexicon-pattern'])
  })

  it('rejects catalog values out of range, through the engine\'s checks', async () => {
    expect(await errorsOf(withEntry(space, ids.character('zoro'), { statCombat: 120 }))).toEqual(['stat-range'])
    expect(await errorsOf(withEntry(space, ids.character('zoro'), { faction: 'pirates' }))).toEqual(['unknown-value'])
  })

  it('rejects rules that name characters the catalog lacks', async () => {
    const rule: Rule = { key: 'ghost', name: 'Ghost', conditions: [{ kind: 'character', character: 'shanks', position: 'any' }], effects: [{ op: 'add', stat: 'combat', amount: 1, scope: 'crew' }], unlocks: null }
    expect(await errorsOf(space, { rules: [rule] })).toEqual(['unknown-character'])
  })

  it('needs a home page, unique slugs and exactly one settings entry', async () => {
    expect(await errorsOf(withEntry(space, 'pg-index', { slug: 'home' }))).toEqual(['no-home'])
    const dupe = { ...space, entries: [...space.entries, entry('page', 'pg-dupe', { title: 'Again', slug: 'index', blocks: [link('bl-quote')] })] }
    expect(await errorsOf(dupe)).toEqual(['duplicate-slug'])
    const twoSettings = { ...space, entries: [...space.entries, entry('siteSettings', 'ss-2', { internalName: 'Another' })] }
    expect(await errorsOf(twoSettings)).toEqual(['site-settings'])
  })

  it('ignores unknown fields and warns about unknown types (expand, then contract)', async () => {
    const expanded = {
      ...withEntry(space, ids.character('zoro'), { newField: 'from a migration not deployed yet' }),
    }
    expanded.entries = [...expanded.entries, entry('comparePage', 'cmp-1', { title: 'Zoro vs Sanji' })]
    const { result } = await build(expanded)
    expect(result.ok).toBe(true)
    expect(result.warnings.map(w => w.code)).toContain('unknown-type')
  })
})
