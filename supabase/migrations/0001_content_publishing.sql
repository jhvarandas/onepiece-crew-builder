-- Content publishing (ARCHITECTURE.md §8.2 and §10.2): the build lease, the snapshot index,
-- the one mutable pointer, the webhook event log and the build log.
--
-- Everything goes through the functions below, called over RPC with the server's secret key.
-- The tables have row-level security on and no grants: the HTTPS client can't express
-- "increment the generation" or "only if my lease is still current", and keeping those
-- invariants inside Postgres is the point of the lesson.
--
-- Times use clock_timestamp(), not now(): now() is the transaction's start time, and a lease
-- must expire by the wall clock.

-- ---------------------------------------------------------------------------
-- Tables

-- The build lease, a singleton. Each acquisition increments the generation, which then
-- fences every write the holder makes: a builder whose lease expired can't promote.
create table public.content_lease (
  id         boolean primary key default true check (id),
  generation bigint not null default 0,
  holder     text,
  expires_at timestamptz not null default '-infinity'
);
insert into public.content_lease default values;

-- Raw snapshots, by hash. The bytes live in Vercel Blob; this is the index.
create table public.content_snapshots (
  raw_hash     text primary key check (raw_hash ~ '^[0-9a-f]{64}$'),
  catalog_hash text not null check (catalog_hash ~ '^[0-9a-f]{64}$'),
  pages_hash   text not null check (pages_hash ~ '^[0-9a-f]{64}$'),
  bytes        integer not null check (bytes > 0),
  blob_url     text not null,
  created_at   timestamptz not null default clock_timestamp()
);

-- The live snapshot, a singleton. The only mutable thing on the read path.
create table public.content_pointer (
  id                     boolean primary key default true check (id),
  raw_hash               text not null references public.content_snapshots (raw_hash),
  promoted_by_generation bigint not null,
  promoted_at            timestamptz not null
);

-- Webhook events, recorded before a build starts. The builder marks the ones its content
-- reflects as processed, and releases the lease only when none remain.
create table public.content_events (
  id           bigint generated always as identity primary key,
  entity_id    text not null,
  entity_type  text not null check (entity_type in ('Entry', 'Asset')),
  kind         text not null check (kind in ('publish', 'unpublish')),
  revision     integer not null default 0,
  received_at  timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);
create index content_events_pending on public.content_events (id) where processed_at is null;

-- One row per build, because Hobby keeps runtime logs for an hour (§10.7).
create table public.content_builds (
  id             bigint generated always as identity primary key,
  trigger        text not null,
  generation     bigint,
  started_at     timestamptz not null,
  finished_at    timestamptz not null default clock_timestamp(),
  result         text not null check (result in ('promoted', 'unchanged', 'rejected', 'failed', 'fenced')),
  raw_hash       text,
  catalog_hash   text,
  pages_hash     text,
  delivery_calls integer not null default 0,
  timings        jsonb not null default '{}',
  errors         jsonb not null default '[]',
  warnings       jsonb not null default '[]',
  purge          text,
  canary         text
);

alter table public.content_lease enable row level security;
alter table public.content_snapshots enable row level security;
alter table public.content_pointer enable row level security;
alter table public.content_events enable row level security;
alter table public.content_builds enable row level security;

revoke all on public.content_lease, public.content_snapshots, public.content_pointer,
  public.content_events, public.content_builds from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The lease

-- The next generation if the lease is free (or expired), otherwise null.
create function public.acquire_lease(p_holder text, p_ttl_seconds integer)
returns bigint
language sql security definer set search_path = ''
as $$
  update public.content_lease
     set generation = generation + 1,
         holder = p_holder,
         expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
   where expires_at <= clock_timestamp()
  returning generation
$$;

-- Extends the lease, only for the current, unexpired generation.
create function public.renew_lease(p_generation bigint, p_ttl_seconds integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.content_lease
     set expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
   where generation = p_generation and expires_at > clock_timestamp();
  return found;
end
$$;

-- 'released'; 'pending' when unprocessed events remain (the builder should loop, or pass
-- p_force when out of time); 'lost' when the generation is no longer current.
create function public.release_lease(p_generation bigint, p_force boolean default false)
returns text
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.content_lease
   where generation = p_generation and expires_at > clock_timestamp()
     for update;
  if not found then
    return 'lost';
  end if;
  if not p_force and exists (select 1 from public.content_events where processed_at is null) then
    return 'pending';
  end if;
  update public.content_lease set holder = null, expires_at = clock_timestamp();
  return 'released';
end
$$;

-- ---------------------------------------------------------------------------
-- Events

create function public.record_event(p_entity_id text, p_entity_type text, p_kind text, p_revision integer)
returns bigint
language sql security definer set search_path = ''
as $$
  insert into public.content_events (entity_id, entity_type, kind, revision)
  values (p_entity_id, p_entity_type, p_kind, coalesce(p_revision, 0))
  returning id
$$;

create function public.pending_events()
returns table (id bigint, entity_id text, kind text, revision integer)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.entity_id, e.kind, e.revision
    from public.content_events e
   where e.processed_at is null
   order by e.id
$$;

create function public.mark_events_processed(p_ids bigint[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  marked integer;
begin
  update public.content_events
     set processed_at = clock_timestamp()
   where id = any (p_ids) and processed_at is null;
  get diagnostics marked = row_count;
  return marked;
end
$$;

-- ---------------------------------------------------------------------------
-- Snapshots and the pointer

-- Content-addressed, so indexing the same snapshot twice is a no-op.
create function public.index_snapshot(p_raw_hash text, p_catalog_hash text, p_pages_hash text, p_bytes integer, p_blob_url text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.content_snapshots (raw_hash, catalog_hash, pages_hash, bytes, blob_url)
  values (p_raw_hash, p_catalog_hash, p_pages_hash, p_bytes, p_blob_url)
  on conflict (raw_hash) do nothing
$$;

create function public.snapshot_url(p_raw_hash text)
returns text
language sql stable security definer set search_path = ''
as $$
  select blob_url from public.content_snapshots where raw_hash = p_raw_hash
$$;

-- Moves the pointer, fenced: only while p_generation holds the lease. The lock on the lease
-- row stops a new acquisition from slipping in between the check and the write. Returns
-- false when fenced off; raises if the snapshot was never indexed.
create function public.promote(p_raw_hash text, p_generation bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.content_lease
   where generation = p_generation and expires_at > clock_timestamp()
     for update;
  if not found then
    return false;
  end if;
  if not exists (select 1 from public.content_snapshots where raw_hash = p_raw_hash) then
    raise exception 'snapshot % is not indexed', p_raw_hash;
  end if;
  insert into public.content_pointer (id, raw_hash, promoted_by_generation, promoted_at)
  values (true, p_raw_hash, p_generation, clock_timestamp())
  on conflict (id) do update
     set raw_hash = excluded.raw_hash,
         promoted_by_generation = excluded.promoted_by_generation,
         promoted_at = excluded.promoted_at;
  return true;
end
$$;

-- The live snapshot, or no row before the first promotion. Read once per request.
create function public.current_pointer()
returns table (raw_hash text, catalog_hash text, pages_hash text, blob_url text, promoted_by_generation bigint, promoted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.raw_hash, s.catalog_hash, s.pages_hash, s.blob_url, p.promoted_by_generation, p.promoted_at
    from public.content_pointer p
    join public.content_snapshots s using (raw_hash)
$$;

-- ---------------------------------------------------------------------------
-- The build log

create function public.record_build(p_build jsonb)
returns bigint
language sql security definer set search_path = ''
as $$
  insert into public.content_builds (
    trigger, generation, started_at, result, raw_hash, catalog_hash, pages_hash,
    delivery_calls, timings, errors, warnings, purge, canary
  )
  values (
    p_build ->> 'trigger',
    (p_build ->> 'generation')::bigint,
    (p_build ->> 'startedAt')::timestamptz,
    p_build ->> 'result',
    p_build ->> 'rawHash',
    p_build ->> 'catalogHash',
    p_build ->> 'pagesHash',
    coalesce((p_build ->> 'deliveryCalls')::integer, 0),
    coalesce(p_build -> 'timings', '{}'),
    coalesce(p_build -> 'errors', '[]'),
    coalesce(p_build -> 'warnings', '[]'),
    p_build ->> 'purge',
    p_build ->> 'canary'
  )
  returning id
$$;

-- ---------------------------------------------------------------------------
-- Grants: the server's secret key (service_role) only. Postgres grants EXECUTE to PUBLIC by
-- default, and Supabase grants it to anon and authenticated, so revoke those first.

revoke execute on function
  public.acquire_lease(text, integer),
  public.renew_lease(bigint, integer),
  public.release_lease(bigint, boolean),
  public.record_event(text, text, text, integer),
  public.pending_events(),
  public.mark_events_processed(bigint[]),
  public.index_snapshot(text, text, text, integer, text),
  public.snapshot_url(text),
  public.promote(text, bigint),
  public.current_pointer(),
  public.record_build(jsonb)
from public, anon, authenticated;

grant execute on function
  public.acquire_lease(text, integer),
  public.renew_lease(bigint, integer),
  public.release_lease(bigint, boolean),
  public.record_event(text, text, text, integer),
  public.pending_events(),
  public.mark_events_processed(bigint[]),
  public.index_snapshot(text, text, text, integer, text),
  public.snapshot_url(text),
  public.promote(text, bigint),
  public.current_pointer(),
  public.record_build(jsonb)
to service_role;
