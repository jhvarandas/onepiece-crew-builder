import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Supabase in a test: PGlite (Postgres 17 in WebAssembly) running the real migration, behind
// a minimal stand-in for PostgREST's RPC endpoint. supabaseStore talks to it over its normal
// fetch path, so the adapter and the SQL are tested together.

const migration = readFileSync(new URL('../../supabase/migrations/0001_content_publishing.sql', import.meta.url), 'utf8')

export async function supabaseInMemory() {
  const db = new PGlite()
  // Supabase's API roles, which the migration's grants refer to.
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`)
  await db.exec(migration)

  /** Runs SQL as the database owner, e.g. to move a lease's expiry into the past. */
  const admin = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows

  const toJson = (value: unknown): unknown => {
    if (typeof value === 'bigint') return Number(value)
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(toJson)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]))
    return value
  }

  let role = 'service_role'
  const fetchFn = async (url: string, init: { method: string, headers: Record<string, string>, body: string }) => {
    const fn = new URL(url).pathname.replace('/rest/v1/rpc/', '')
    const args = JSON.parse(init.body) as Record<string, unknown>
    const reply = (status: number, body: unknown) =>
      ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) })

    const [proc] = (await db.query<{ retset: boolean, rettype: string }>(
      `select proretset as retset, prorettype::regtype::text as rettype from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
      [fn],
    )).rows
    if (!proc) return reply(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` })

    const names = Object.keys(args)
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`
    const params = names.map(n => (args[n] !== null && typeof args[n] === 'object' && !Array.isArray(args[n]) ? JSON.stringify(args[n]) : args[n]))
    try {
      await db.exec(`set role ${role}`)
      const rows = (await db.query<Record<string, unknown>>(proc.retset ? `select * from ${call}` : `select ${call} as value`, params)).rows
      if (proc.retset) return reply(200, toJson(rows))
      if (proc.rettype === 'void') return reply(200, undefined)
      return reply(200, toJson(rows[0]!.value))
    }
    catch (error) {
      return reply(400, { message: (error as Error).message })
    }
    finally {
      await db.exec('reset role')
    }
  }

  return {
    db,
    admin,
    fetchFn,
    /** Calls as another API role, to check the grants. */
    as: (r: 'anon' | 'authenticated' | 'service_role') => {
      role = r
    },
  }
}
