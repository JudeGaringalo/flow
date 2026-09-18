-- F.L.O.W. initial schema. Run once in a NEW Supabase project.
-- Existing similarly-named tables should be reviewed before applying this migration.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

create table public.flow_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.flow_admins enable row level security;
create policy "Installer can see own role" on public.flow_admins for select to authenticated using (user_id=auth.uid());
grant select on public.flow_admins to authenticated;
revoke all on public.flow_admins from anon;

create function public.flow_is_admin() returns boolean language sql stable security definer set
  search_path='' as $$
  select exists(
    select 1
    from public.flow_admins
    where user_id = auth.uid()
  );
$$;
revoke all on function public.flow_is_admin() from public;
grant execute on function public.flow_is_admin() to authenticated;

create table public.flow_nodes (
  id text primary key check(id ~ '^[A-Z0-9-]{3,40}$'),
  name text not null check(length(name) between 1 and 80),
  area text not null default '' check(length(area)<=100),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  location extensions.geography(Point, 4326) generated always as
    (extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography)
      stored,
  probes jsonb not null default '[null,null,null]'::jsonb,
  current_level smallint check(current_level between 0 and 3),
  quality text not null default 'unknown' check(quality in ('unknown', 'valid', 'fault')),
  last_seen timestamptz,
  state_version bigint not null default 0,
  rssi integer check(rssi between -127 and 0),
  firmware text,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.flow_nodes using gist(location);
alter table public.flow_nodes enable row level security;
create policy "Public observations" on public.flow_nodes for select to anon, authenticated using (is_public);
create policy "Installer observations" on public.flow_nodes for select to authenticated using (public.flow_is_admin());
grant select on public.flow_nodes to anon, authenticated;
-- Writes are performed only by authenticated server endpoints.
revoke insert, update, delete on public.flow_nodes from anon, authenticated;

create table public.flow_events (
  id uuid primary key default gen_random_uuid(),
  node_id text not null references public.flow_nodes(id) on delete cascade,
  level smallint check(level between 0 and 3),
  probes jsonb not null,
  quality text not null check(quality in ('valid', 'fault')),
  source_version bigint not null,
  recorded_at timestamptz not null default now()
);
create index on public.flow_events(node_id, recorded_at desc);
alter table public.flow_events enable row level security;
create policy "Public event history" on public.flow_events for select to anon, authenticated using
  (exists(select 1 from public.flow_nodes n where n.id=node_id and n.is_public));
grant select on public.flow_events to anon, authenticated;
revoke insert, update, delete on public.flow_events from anon, authenticated;

create table public.flow_device_keys (
  node_id text primary key references public.flow_nodes(id) on delete cascade,
  token_hash text not null check(length(token_hash)=64),
  updated_at timestamptz not null default now()
);
create table public.flow_receipts (
  node_id text not null references public.flow_nodes(id) on delete cascade,
  message_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(node_id, message_id)
);
create table public.flow_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id text not null references public.flow_nodes(id) on delete cascade,
  min_level smallint not null check(min_level between 1 and 3),
  primary key(user_id, node_id)
);
alter table public.flow_follows enable row level security;
create policy "Own follows" on public.flow_follows for all to authenticated using (user_id=auth.uid())
  with check
  (user_id=auth.uid() and exists(select 1 from public.flow_nodes n where n.id=node_id and n.is_public));
grant select, insert, update, delete on public.flow_follows to authenticated;
revoke all on public.flow_follows from anon;

create table public.flow_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
alter table public.flow_push_subscriptions enable row level security;
-- No client writes; the endpoint validates destination hosts before storing subscriptions.
revoke all on public.flow_push_subscriptions from anon, authenticated;

create table public.flow_push_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.flow_events(id) on delete cascade,
  subscription_id uuid not null references public.flow_push_subscriptions(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending', 'running', 'sent', 'skipped',
    'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(event_id, subscription_id)
);
create index on public.flow_push_jobs(state, next_attempt_at);
create table public.flow_ai_cache (
  cache_key text primary key,
  node_id text not null references public.flow_nodes(id) on delete cascade,
  summary text not null,
  provider text not null,
  source_version bigint not null,
  expires_at timestamptz not null
);
create table public.flow_rate_limits (
  bucket text primary key,
  starts_at timestamptz not null,
  uses integer not null default 1
);
-- Every sensitive table has RLS and no browser policy or grant.
do $$
declare
  t text;
begin
  foreach t in array array[
    'flow_device_keys',
    'flow_receipts',
    'flow_push_jobs',
    'flow_ai_cache',
    'flow_rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
-- The server role can operate these tables; it must never be placed in frontend config.
grant all on public.flow_nodes, public.flow_events, public.flow_admins, public.flow_device_keys,
  public.flow_receipts,
  public.flow_follows, public.flow_push_subscriptions, public.flow_push_jobs, public.flow_ai_cache,
    public.flow_rate_limits to service_role;

create function public.flow_take_limit(
  p_bucket text,
  p_limit integer,
  p_seconds integer
)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  hits integer;
begin
  insert into public.flow_rate_limits(bucket, starts_at, uses)
  values(p_bucket, now(), 1)
  on conflict(bucket) do update set
    uses = case
      when public.flow_rate_limits.starts_at < now() - make_interval(secs => p_seconds)
        then 1
      else public.flow_rate_limits.uses + 1
    end,
    starts_at = case
      when public.flow_rate_limits.starts_at < now() - make_interval(secs => p_seconds)
        then now()
      else public.flow_rate_limits.starts_at
    end
  returning uses into hits;

  return hits <= p_limit;
end
$$;
revoke all on function public.flow_take_limit(text, integer, integer) from public, anon,
  authenticated;
grant execute on function public.flow_take_limit(text, integer, integer) to service_role;

-- The server recomputes level and quality from raw probes. It never trusts a client status label.
-- One event per state transition. Heartbeats update last_seen without growing event history.
create function public.flow_accept_reading(
  p_node_id text,
  p_message_id uuid,
  p_probes jsonb,
  p_rssi integer,
  p_firmware text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  n public.flow_nodes;
  l1 boolean;
  l2 boolean;
  l3 boolean;
  lev smallint;
  q text;
  changed boolean;
  ev uuid;
begin
  if jsonb_typeof(p_probes) <> 'array'
    or jsonb_array_length(p_probes) <> 3
    or jsonb_typeof(p_probes->0) <> 'boolean'
    or jsonb_typeof(p_probes->1) <> 'boolean'
    or jsonb_typeof(p_probes->2) <> 'boolean'
  then
    raise exception 'Expected three boolean probe values';
  end if;

  select * into n
  from public.flow_nodes
  where id = p_node_id
  for update;

  if not found then
    raise exception 'Unknown node';
  end if;

  insert into public.flow_receipts(node_id, message_id)
  values(p_node_id, p_message_id)
  on conflict do nothing;

  if not found then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'state_version', n.state_version
    );
  end if;

  l1 = (p_probes->>0)::boolean;
  l2 = (p_probes->>1)::boolean;
  l3 = (p_probes->>2)::boolean;

  if (l2 and not l1) or (l3 and (not l1 or not l2)) then
    lev = null;
    q = 'fault';
  else
    lev = case
      when l3 then 3
      when l2 then 2
      when l1 then 1
      else 0
    end;
    q = 'valid';
  end if;

  changed = n.last_seen is null
    or n.probes is distinct from p_probes
    or n.quality is distinct from q;

  update public.flow_nodes set
    probes = p_probes,
    current_level = lev,
    quality = q,
    last_seen = now(),
    state_version = n.state_version + case when changed then 1 else 0 end,
    rssi = p_rssi,
    firmware = p_firmware
  where id = p_node_id;

  if changed then
    insert into public.flow_events(node_id, level, quality, probes, source_version)
    values(p_node_id, lev, q, p_probes, n.state_version + 1)
    returning id into ev;

    if q = 'valid'
      and lev > 0
      and (n.current_level is null or lev > n.current_level)
      and n.is_public
    then
      insert into public.flow_push_jobs(event_id, subscription_id)
      select ev, s.id
      from public.flow_follows f
      join public.flow_push_subscriptions s on s.user_id = f.user_id
      where f.node_id = p_node_id and lev >= f.min_level
      on conflict do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'changed', changed,
    'level', lev,
    'quality', q,
    'state_version', n.state_version + case when changed then 1 else 0 end,
    'received_at', now()
  );
end
$$;
revoke all on function public.flow_accept_reading(text, uuid, jsonb, integer, text) from public,
  anon, authenticated;
grant execute on function public.flow_accept_reading(text, uuid, jsonb, integer, text) to
  service_role;

-- Broadcast only an invalidation, not trusted client-supplied telemetry. The app refetches
-- from RLS-protected tables on every invalidation, so forged public events cannot set levels.
create function public.flow_broadcast_node() returns trigger language plpgsql security definer set
  search_path='' as $$
begin
  if coalesce(new.is_public, false) or coalesce(old.is_public, false) then
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.id, old.id)),
      'node-changed',
      'flow:public',
      false
    );
  end if;

  return coalesce(new, old);
end
$$;
create trigger flow_node_broadcast after insert or update or delete on public.flow_nodes for each
  row execute function public.flow_broadcast_node();
revoke all on function public.flow_broadcast_node() from public, anon, authenticated;

create function public.flow_nearby(
  p_node_id text,
  p_radius_m integer default 3000
)
returns table(
  id text,
  name text,
  latitude double precision,
  longitude double precision,
  probes jsonb,
  quality text,
  current_level smallint,
  last_seen timestamptz,
  state_version bigint,
  distance_m double precision
)
language sql stable security invoker set search_path='' as $$
  select
    n.id,
    n.name,
    n.latitude,
    n.longitude,
    n.probes,
    n.quality,
    n.current_level,
    n.last_seen,
    n.state_version,
    extensions.st_distance(n.location, s.location) as distance_m
  from public.flow_nodes n
  cross join public.flow_nodes s
  where s.id = p_node_id
    and n.id <> s.id
    and n.is_public
    and s.is_public
    and extensions.st_dwithin(n.location, s.location, least(greatest(p_radius_m, 1), 5000))
  order by extensions.st_distance(n.location, s.location)
  limit 4;
$$;
revoke all on function public.flow_nearby(text, integer) from public;
grant execute on function public.flow_nearby(text, integer) to service_role, anon, authenticated;

create function public.flow_claim_push_jobs(
  p_limit integer default 20
)
returns setof public.flow_push_jobs language plpgsql security definer set search_path='' as $$
begin
  return query
  update public.flow_push_jobs j set
    state = 'running',
    attempts = j.attempts + 1,
    leased_until = now() + interval '3 minutes'
  where j.id in(
    select q.id
    from public.flow_push_jobs q
    where q.attempts < 5
      and q.next_attempt_at <= now()
      and (q.state = 'pending' or (q.state = 'running' and q.leased_until < now()))
    order by q.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 25)
  )
  returning j.*;
end
$$;
revoke all on function public.flow_claim_push_jobs(integer) from public, anon, authenticated;
grant execute on function public.flow_claim_push_jobs(integer) to service_role;
