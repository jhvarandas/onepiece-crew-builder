import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONTENT_TYPES, LEXICON_FIELDS, PRESET_SEAT_FIELDS, STAT_FIELDS, WEIGHT_FIELDS } from '../../server/content/model'
import { contentVocab } from '../../server/content/vocab'

const vocabPath = fileURLToPath(new URL('../../contentful/vocab.json', import.meta.url))
const migrationPath = fileURLToPath(new URL('../../contentful/migrations/001-content-model.cjs', import.meta.url))

describe('contentful/vocab.json', () => {
  it('matches the closed lists in code (run `pnpm content:vocab` to update)', () => {
    const expected = `${JSON.stringify(contentVocab(), null, 2)}\n`
    if (process.env.UPDATE_VOCAB) writeFileSync(vocabPath, expected)
    expect(readFileSync(vocabPath, 'utf8')).toBe(expected)
  })
})

/** Records what the migration would create, without calling Contentful. */
function recordMigration() {
  const types = new Map<string, Map<string, { type?: string, required?: boolean, linkType?: string }>>()
  const chain = (target: Record<string, unknown>) =>
    new Proxy(target, { get: (t, prop: string) => (prop in t ? t[prop] : () => chain(t)) })
  const migration = {
    createContentType(id: string) {
      const fields = new Map<string, { type?: string, required?: boolean, linkType?: string }>()
      types.set(id, fields)
      const contentType: Record<string, unknown> = {
        createField(fieldId: string) {
          const record: { type?: string, required?: boolean, linkType?: string } = {}
          fields.set(fieldId, record)
          const field: Record<string, unknown> = {
            type: (v: string) => ((record.type = v), chain(field)),
            required: (v: boolean) => ((record.required = v), chain(field)),
            linkType: (v: string) => ((record.linkType = v), chain(field)),
          }
          return chain(field)
        },
      }
      return chain(contentType)
    },
  }
  createRequire(import.meta.url)(migrationPath)(migration)
  return types
}

describe('content model migration', () => {
  // Recorded lazily, after the vocab test above has had the chance to write vocab.json.
  let recorded: ReturnType<typeof recordMigration> | undefined
  const types = { get: (type: string) => (recorded ??= recordMigration()).get(type), all: () => (recorded ??= recordMigration()) }
  const fields = (type: string) => [...types.get(type)!.keys()]

  it('creates the 12 content types the adapter reads, within the free tier', () => {
    expect([...types.all().keys()].sort()).toEqual([...CONTENT_TYPES].sort())
    for (const [, f] of types.all()) expect(f.size).toBeLessThanOrEqual(50)
  })

  it('uses the field ids the adapter reads', () => {
    expect(fields('character')).toEqual(expect.arrayContaining([...Object.values(STAT_FIELDS), 'key', 'formerKeys', 'status', 'roles', 'powerType', 'faction', 'haki', 'portrait']))
    expect(fields('objective')).toEqual(expect.arrayContaining([...Object.values(WEIGHT_FIELDS), 'requiredPositions']))
    expect(fields('crewPreset')).toEqual(expect.arrayContaining(PRESET_SEAT_FIELDS.map(s => s.field)))
    expect(fields('siteSettings')).toEqual(expect.arrayContaining([...LEXICON_FIELDS, 'navigation', 'footerText']))
    for (const block of ['blockHero', 'blockFeatureGrid', 'blockCta']) {
      expect(fields(block)).toEqual(expect.arrayContaining(['actionLabel', 'actionTarget', 'actionUrl']))
    }
    expect(types.get('crewPreset')!.get('captain')).toMatchObject({ type: 'Link', required: true })
    expect(types.get('blockCta')!.get('body')).toMatchObject({ type: 'RichText' })
  })
})
