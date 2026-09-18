-- Apply AFTER 001_flow.sql. This additive migration does not reset tables/data.
-- Atomic server-only operations used by the Next.js API routes.
begin;

create or replace function public.flow_write_node(
  p_action text,
  p_id text,
  p_name text,
  p_area text,
  p_latitude double precision,
  p_longitude double precision,
  p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_action is null or p_action not in ('create', 'update', 'rotate') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;

  if p_action in ('create', 'rotate')
    and (p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$')
  then
    raise exception 'Invalid token hash' using errcode = '22023';
  end if;

  if p_action = 'create' then
    insert into public.flow_nodes(id, name, area, latitude, longitude)
    values(p_id, p_name, coalesce(p_area, ''), p_latitude, p_longitude);
  else
    perform 1
    from public.flow_nodes
    where id = p_id
    for update;

    if not found then
      raise exception 'Node not found' using errcode = 'P0002';
    end if;

    if p_action = 'update' then
      update public.flow_nodes set
        name = p_name,
        area = coalesce(p_area, ''),
        latitude = p_latitude,
        longitude = p_longitude
      where id = p_id;
    end if;
  end if;

  if p_action in ('create', 'rotate') then
    insert into public.flow_device_keys(node_id, token_hash, updated_at)
    values(p_id, p_token_hash, now())
    on conflict(node_id) do update set
      token_hash = excluded.token_hash,
      updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object('id', p_id, 'updated', true);
end
$$;
revoke all on function public.flow_write_node(text, text, text, text, double precision, double
  precision, text) from public, anon, authenticated;
grant execute on function public.flow_write_node(text, text, text, text, double precision, double
  precision, text) to service_role;

create or replace function public.flow_store_subscription(
  p_user_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid;
  total integer;
begin
  -- Serialize a user's registrations so the five-subscription cap is real.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  select user_id into owner_id
  from public.flow_push_subscriptions
  where endpoint = p_endpoint
  for update;

  if found and owner_id <> p_user_id then
    raise exception 'Subscription owned by another session' using errcode = '42501';
  end if;

  if owner_id is null then
    select count(*) into total
    from public.flow_push_subscriptions
    where user_id = p_user_id;

    if total >= 5 then
      raise exception 'Subscription limit' using errcode = '54000';
    end if;
  end if;

  -- Conflict predicate also blocks a cross-user race for a brand-new endpoint.
  insert into public.flow_push_subscriptions(user_id, endpoint, p256dh, auth_key)
  values(p_user_id, p_endpoint, p_p256dh, p_auth_key)
  on conflict(endpoint) do update set
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key
  where public.flow_push_subscriptions.user_id = excluded.user_id;

  if not found then
    raise exception 'Subscription owned by another session' using errcode = '42501';
  end if;

  return true;
end
$$;
revoke all on function public.flow_store_subscription(uuid, text, text, text) from public, anon,
  authenticated;
grant execute on function public.flow_store_subscription(uuid, text, text, text) to service_role;

commit;
