// Loads contentful/seed.json into a Contentful environment through the Content Management API:
// the test catalog (Straw Hats and friends), a preset, a home page and the site settings.
// Run the content-model migration on the environment first.
//
//   pnpm content:seed --environment dev
//
// Reads CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN from the environment or .env.
// Idempotent: entries keep the ids in seed.json, unchanged published entries are skipped,
// and changed ones are overwritten and republished. Entries not in seed.json are left alone.
// seed.json is generated from test/fixtures/space.ts by `pnpm content:seed-data`.

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const CMA = 'https://api.contentful.com'
const JSON_TYPE = 'application/vnd.contentful.management.v1+json'

/** Key-order-independent JSON, to compare fields with what Contentful returns. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Fields as the CMA stores them: one value per locale. Contentful drops empty lists, so we do too. */
const localized = (fields, locale) => Object.fromEntries(Object.entries(fields)
  .filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
  .map(([k, v]) => [k, { [locale]: v }]))

/**
 * @param {object} options
 * @param {string} options.space
 * @param {string} options.environment
 * @param {string} options.token
 * @param {{ locale: string, entries: { id: string, contentType: string, fields: Record<string, unknown> }[] }} options.data
 * @param {(url: string, init: { method: string, headers: Record<string, string>, body?: string }) => Promise<{ ok: boolean, status: number, headers: Headers, json(): Promise<any>, text(): Promise<string> }>} [options.fetchFn]
 * @param {(line: string) => void} [options.log]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @returns {Promise<{ created: number, updated: number, unchanged: number }>}
 */
export async function seed({ space, environment, token, data, fetchFn = fetch, log = console.log, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const base = `${CMA}/spaces/${encodeURIComponent(space)}/environments/${encodeURIComponent(environment)}`

  async function request(method, path, { body, headers = {}, allow404 = false } = {}) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchFn(base + path, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': JSON_TYPE, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (res.status === 429 && attempt < 6) {
        const reset = Number(res.headers.get('X-Contentful-RateLimit-Reset')) || 1
        await sleep(reset * 1000)
        continue
      }
      if (res.status === 404 && allow404) return null
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`${method} ${path} failed with ${res.status}: ${detail.slice(0, 2000)}`)
      }
      return res.json()
    }
  }

  const types = await request('GET', '/content_types?limit=1000')
  const have = new Set(types.items.map(t => t.sys.id))
  const missing = [...new Set(data.entries.map(e => e.contentType))].filter(t => !have.has(t))
  if (missing.length) {
    throw new Error(`Environment "${environment}" lacks content types ${missing.join(', ')}. Run the content-model migration first.`)
  }

  const counts = { created: 0, updated: 0, unchanged: 0 }
  for (const entry of data.entries) {
    const fields = localized(entry.fields, data.locale)
    const path = `/entries/${encodeURIComponent(entry.id)}`
    const existing = await request('GET', path, { allow404: true })

    if (existing && existing.sys.contentType.sys.id !== entry.contentType) {
      throw new Error(`Entry ${entry.id} exists as a ${existing.sys.contentType.sys.id}, not a ${entry.contentType}. Remove it or change its id.`)
    }
    const published = existing?.sys.publishedVersion !== undefined && existing.sys.publishedVersion + 1 === existing.sys.version
    if (existing && published && stable(existing.fields) === stable(fields)) {
      counts.unchanged++
      continue
    }

    const saved = await request('PUT', path, {
      body: { fields },
      headers: existing ? { 'X-Contentful-Version': String(existing.sys.version) } : { 'X-Contentful-Content-Type': entry.contentType },
    })
    await request('PUT', `${path}/published`, { headers: { 'X-Contentful-Version': String(saved.sys.version) } })
    counts[existing ? 'updated' : 'created']++
    log(`${existing ? 'updated' : 'created'} ${entry.contentType} ${entry.id}`)
  }
  return counts
}

async function main() {
  const { values } = parseArgs({ options: { environment: { type: 'string', short: 'e' } } })
  const space = process.env.CONTENTFUL_SPACE_ID
  const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN
  if (!values.environment || !space || !token) {
    console.error('Usage: pnpm content:seed --environment <dev|master>\n'
      + 'Needs CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN in the environment or .env.')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'))
  console.log(`Seeding ${data.entries.length} entries into space ${space}, environment ${values.environment}`)
  const counts = await seed({ space, environment: values.environment, token, data })
  console.log(`Done: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
