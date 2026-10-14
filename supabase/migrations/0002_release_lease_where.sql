-- release_lease's final UPDATE had no WHERE clause. Supabase loads pg-safeupdate for API
-- requests, which rejects UPDATE and DELETE without one, even inside a security definer
-- function, so every release failed with "UPDATE requires a WHERE clause". Scoping it to the
-- caller's generation also states the intent: only the current holder clears the lease.
--
-- create or replace keeps the function's owner and grants from 0001.

create or replace function public.release_lease(p_generation bigint, p_force boolean default false)
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
  update public.content_lease
     set holder = null, expires_at = clock_timestamp()
   where generation = p_generation;
  return 'released';
end
$$;
