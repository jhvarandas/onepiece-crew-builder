import { STATS } from '#shared/engine'
import type { SpaceContent } from '../../server/content/contentful'
import { PRESET_SEAT_FIELDS, STAT_FIELDS, WEIGHT_FIELDS } from '../../server/content/model'
import type { DeliveryItem } from '../../server/content/raw'
import { catalog, strawHats } from './catalog'

// The test catalog as the Content Delivery API would return it (include=0, one locale),
// plus a small set of pages, so the adapter can be tested end to end without Contentful.

type Fields = Record<string, unknown>

export function link(id: string, linkType: 'Entry' | 'Asset' = 'Entry') {
  return { sys: { type: 'Link', linkType, id } }
}

export function entry(type: string, id: string, fields: Fields, revision = 1): DeliveryItem {
  return { sys: { id, type: 'Entry', revision, contentType: { sys: { id: type } } }, fields }
}

export function asset(id: string, fields: { title: string, url: string, contentType: string, width?: number, height?: number }): DeliveryItem {
  return {
    sys: { id, type: 'Asset', revision: 1 },
    fields: {
      title: fields.title,
      file: {
        url: fields.url,
        contentType: fields.contentType,
        details: fields.width ? { image: { width: fields.width, height: fields.height } } : {},
      },
    },
  }
}

/** Entry ids: the content type initial plus the key, like Contentful's opaque ids but readable. */
export const ids = {
  character: (key: string) => `ch-${key}`,
  ability: (key: string) => `ab-${key}`,
  objective: (key: string) => `ob-${key}`,
}

export function spaceFixture(): SpaceContent {
  const entries: DeliveryItem[] = []

  for (const c of catalog.characters) {
    const fields: Fields = {
      key: c.key,
      name: c.name,
      status: c.status,
      roles: c.roles,
      powerType: c.powerType,
      faction: c.faction,
    }
    if (c.formerKeys.length) fields.formerKeys = c.formerKeys
    if (c.haki.length) fields.haki = c.haki
    for (const s of STATS) fields[STAT_FIELDS[s]] = c.stats[s]
    if (c.key === 'luffy') {
      fields.epithet = 'Straw Hat'
      fields.bounty = 3000000000
      fields.portrait = link('as-luffy', 'Asset')
      fields.abilities = [link(ids.ability('gomu-gomu'))]
    }
    entries.push(entry('character', ids.character(c.key), fields))
  }

  for (const a of catalog.abilities) {
    entries.push(entry('ability', ids.ability(a.key), { key: a.key, name: a.name, kind: a.kind }))
  }

  for (const o of catalog.objectives) {
    const fields: Fields = { key: o.key, name: o.name, requiredPositions: o.requiredPositions }
    for (const s of STATS) if (o.weights[s] !== undefined) fields[WEIGHT_FIELDS[s]] = o.weights[s]
    entries.push(entry('objective', ids.objective(o.key), fields))
  }

  const presetFields: Fields = { key: 'straw-hats', name: 'Straw Hat Pirates' }
  for (const { position, character } of strawHats) {
    const seat = PRESET_SEAT_FIELDS.find(s => s.position === position)!
    presetFields[seat.field] = link(ids.character(character))
  }
  entries.push(entry('crewPreset', 'cp-straw-hats', presetFields))

  entries.push(entry('concept', 'co-wano', { key: 'wano', label: 'Wano', facet: 'arc', synonyms: ['Land of Wano'] }))

  entries.push(entry('blockHero', 'bl-hero', {
    internalName: 'Home hero',
    headline: 'Build your crew',
    featuredCharacter: link(ids.character('luffy')),
    actionLabel: 'Start with the Straw Hats',
    actionTarget: [link('cp-straw-hats')],
  }))
  entries.push(entry('blockFeatureGrid', 'bl-grid', {
    internalName: 'Home grid',
    heading: 'Meet the crew',
    items: [link(ids.character('zoro')), link('fi-compare'), link(ids.ability('monster-trio'))],
    actionLabel: 'Compare Zoro and Sanji',
    actionTarget: [link(ids.character('zoro')), link(ids.character('sanji'))],
  }))
  entries.push(entry('featureItem', 'fi-compare', { title: 'Compare', body: 'Side by side, in one position.' }))
  entries.push(entry('blockCta', 'bl-cta', {
    internalName: 'Home CTA',
    heading: 'Survive the Grand Line',
    body: {
      nodeType: 'document',
      data: {},
      content: [{
        nodeType: 'paragraph',
        data: {},
        content: [
          { nodeType: 'text', value: 'You need a ', marks: [], data: {} },
          { nodeType: 'text', value: 'navigator', marks: [{ type: 'bold' }], data: {} },
          { nodeType: 'text', value: ' like ', marks: [], data: {} },
          {
            nodeType: 'entry-hyperlink',
            data: { target: link(ids.character('nami')) },
            content: [{ nodeType: 'text', value: 'Nami', marks: [], data: {} }],
          },
          { nodeType: 'text', value: '.', marks: [], data: {} },
        ],
      }],
    },
    actionLabel: 'Auto-fill a crew',
    actionTarget: [link(ids.objective('grand-line'))],
  }))
  entries.push(entry('blockTestimonial', 'bl-quote', {
    internalName: 'Luffy quote',
    quote: 'I\'m gonna be King of the Pirates!',
    speaker: link(ids.character('luffy')),
  }))
  entries.push(entry('page', 'pg-index', {
    title: 'Home',
    slug: 'index',
    blocks: [link('bl-hero'), link('bl-grid'), link('bl-cta'), link('bl-quote')],
    concepts: [link('co-wano')],
    indexable: true,
  }))
  entries.push(entry('siteSettings', 'ss-main', {
    internalName: 'Site settings',
    navigation: [link('pg-index')],
    footerText: 'A learning sandbox.',
    namePatterns: ['The {adjective} {noun} Pirates', '{noun} Crew'],
    nameAdjectives: ['Rusty', 'Laughing', 'Tidal'],
    nameNouns: ['Anchor', 'Gull', 'Barrel'],
  }))

  const assets = [asset('as-luffy', { title: 'Luffy', url: '//images.ctfassets.net/x/luffy.png', contentType: 'image/png', width: 800, height: 1000 })]
  return { entries, assets, calls: 2 }
}

/** A copy with one entry's fields changed, or the entry removed when `fields` is null. */
export function withEntry(space: SpaceContent, id: string, fields: Fields | null): SpaceContent {
  const entries = space.entries
    .filter(e => fields !== null || e.sys.id !== id)
    .map(e => (e.sys.id === id && fields ? { ...e, fields: { ...e.fields, ...fields } } : e))
  return { ...space, entries }
}
