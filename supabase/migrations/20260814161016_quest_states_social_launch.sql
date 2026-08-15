begin;

alter table public.quests
  add column if not exists state text;

update public.quests
set state = case when active then 'active' else 'paused' end
where state is null;

alter table public.quests
  alter column state set default 'active',
  alter column state set not null,
  drop constraint if exists quests_state_check,
  add constraint quests_state_check check (state in ('testing', 'active', 'paused'));

create or replace function private.sync_quest_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.active := new.state = 'active';
  return new;
end;
$$;

revoke all on function private.sync_quest_state() from public, anon, authenticated;

drop trigger if exists quests_sync_state on public.quests;
create trigger quests_sync_state
before insert or update on public.quests
for each row execute function private.sync_quest_state();

create table if not exists private.quest_testers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists private.action_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action ~ '^[a-z][a-z0-9_-]{2,39}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, action, window_started_at)
);

create table if not exists private.verification_alerts (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  kind text not null check (kind in ('stuck_submission', 'repeated_failures')),
  submission_id uuid references public.submissions(id) on delete cascade,
  quest_id text references public.quests(id) on delete cascade,
  detail jsonb not null default '{}'::jsonb,
  occurrences integer not null default 1 check (occurrences > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists verification_alerts_open_idx
  on private.verification_alerts (kind, last_seen_at desc)
  where resolved_at is null;

create table if not exists private.maintenance_runs (
  name text primary key check (name ~ '^[a-z][a-z0-9_-]{2,39}$'),
  last_started_at timestamptz not null,
  last_completed_at timestamptz,
  detail jsonb not null default '{}'::jsonb
);

insert into private.quest_testers (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

alter table public.submissions
  add column if not exists evidence_deleted_at timestamptz;

create unique index if not exists submissions_evidence_hash_uniq
  on public.submissions (evidence_hash);

create index if not exists submissions_evidence_retention_idx
  on public.submissions (created_at)
  where evidence_deleted_at is null and status <> 'pending';

create or replace function public.irlquest_is_tester(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from private.quest_testers qt where qt.user_id = p_user_id
  );
$$;

create or replace function public.irlquest_take_rate_limit(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_action !~ '^[a-z][a-z0-9_-]{2,39}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 60 and 86400 then
    raise exception using errcode = 'P0001', message = 'INVALID_RATE_LIMIT';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.action_rate_limits (
    user_id, action, window_started_at, request_count
  ) values (
    p_user_id, p_action, v_window, 1
  )
  on conflict (user_id, action, window_started_at) do update
  set request_count = private.action_rate_limits.request_count + 1
  where private.action_rate_limits.request_count < p_limit
  returning request_count into v_count;

  delete from private.action_rate_limits
  where user_id = p_user_id
    and window_started_at < clock_timestamp() - interval '2 days';

  return v_count is not null;
end;
$$;

create or replace function public.irlquest_claim_maintenance(
  p_name text,
  p_min_interval_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed text;
begin
  if p_name !~ '^[a-z][a-z0-9_-]{2,39}$'
    or p_min_interval_seconds not between 30 and 86400 then
    raise exception using errcode = 'P0001', message = 'INVALID_MAINTENANCE_CLAIM';
  end if;

  insert into private.maintenance_runs (name, last_started_at)
  values (p_name, clock_timestamp())
  on conflict (name) do update
  set last_started_at = excluded.last_started_at
  where private.maintenance_runs.last_started_at
    <= clock_timestamp() - make_interval(secs => p_min_interval_seconds)
  returning name into v_claimed;

  return v_claimed is not null;
end;
$$;

create or replace function public.irlquest_complete_maintenance(
  p_name text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update private.maintenance_runs
  set last_completed_at = clock_timestamp(),
      detail = coalesce(p_detail, '{}'::jsonb)
  where name = p_name;
end;
$$;

create or replace function public.irlquest_scan_verification_health()
returns table (alert_kind text, open_count bigint)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into private.verification_alerts (
    fingerprint, kind, submission_id, detail
  )
  select
    'stuck:' || s.id::text,
    'stuck_submission',
    s.id,
    jsonb_build_object(
      'created_at', s.created_at,
      'processing_attempts', s.processing_attempts,
      'transaction_hash_present', s.transaction_hash is not null
    )
  from public.submissions s
  where s.status = 'pending'
    and s.created_at < clock_timestamp() - interval '10 minutes'
    and (
      s.processing_lease_until is null
      or s.processing_lease_until <= clock_timestamp()
    )
  on conflict (fingerprint) do update
  set detail = excluded.detail,
      occurrences = private.verification_alerts.occurrences + 1,
      last_seen_at = clock_timestamp(),
      resolved_at = null;

  update private.verification_alerts va
  set resolved_at = clock_timestamp()
  where va.kind = 'stuck_submission'
    and va.resolved_at is null
    and not exists (
      select 1
      from public.submissions s
      where s.id = va.submission_id
        and s.status = 'pending'
        and s.created_at < clock_timestamp() - interval '10 minutes'
        and (
          s.processing_lease_until is null
          or s.processing_lease_until <= clock_timestamp()
        )
    );

  with failing_quests as (
    select
      da.quest_id,
      count(*)::integer as total_count,
      count(*) filter (where s.status in ('rejected', 'review'))::integer as failure_count
    from public.submissions s
    join public.daily_assignments da on da.id = s.assignment_id
    where s.created_at >= clock_timestamp() - interval '24 hours'
      and s.status in ('accepted', 'rejected', 'review')
    group by da.quest_id
    having count(*) >= 3
      and count(*) filter (where s.status in ('rejected', 'review')) >= 3
      and count(*) filter (where s.status in ('rejected', 'review'))::numeric / count(*) >= 0.75
  )
  insert into private.verification_alerts (
    fingerprint, kind, quest_id, detail
  )
  select
    'failures:' || fq.quest_id,
    'repeated_failures',
    fq.quest_id,
    jsonb_build_object(
      'window_hours', 24,
      'total_count', fq.total_count,
      'failure_count', fq.failure_count
    )
  from failing_quests fq
  on conflict (fingerprint) do update
  set detail = excluded.detail,
      occurrences = private.verification_alerts.occurrences + 1,
      last_seen_at = clock_timestamp(),
      resolved_at = null;

  update private.verification_alerts va
  set resolved_at = clock_timestamp()
  where va.kind = 'repeated_failures'
    and va.resolved_at is null
    and not exists (
      select 1
      from (
        select da.quest_id
        from public.submissions s
        join public.daily_assignments da on da.id = s.assignment_id
        where s.created_at >= clock_timestamp() - interval '24 hours'
          and s.status in ('accepted', 'rejected', 'review')
        group by da.quest_id
        having count(*) >= 3
          and count(*) filter (where s.status in ('rejected', 'review')) >= 3
          and count(*) filter (where s.status in ('rejected', 'review'))::numeric / count(*) >= 0.75
      ) current_failure
      where current_failure.quest_id = va.quest_id
    );

  return query
  select va.kind, count(*)::bigint
  from private.verification_alerts va
  where va.resolved_at is null
  group by va.kind
  order by va.kind;
end;
$$;

create or replace function public.irlquest_leaderboard(p_limit integer default 10)
returns table (
  rank_position bigint,
  user_id uuid,
  display_name text,
  handle text,
  avatar_initials text,
  total_xp bigint,
  current_streak integer,
  longest_streak integer,
  completed_quests bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scores as (
    select
      p.id as user_id,
      p.display_name,
      p.handle,
      p.avatar_initials,
      coalesce(sum(x.amount), 0)::bigint as total_xp,
      p.current_streak,
      p.longest_streak,
      count(x.submission_id)::bigint as completed_quests
    from public.profiles p
    left join public.xp_events x on x.user_id = p.id
    group by p.id
  ), ranked as (
    select
      row_number() over (
        order by total_xp desc, current_streak desc, handle asc
      ) as rank_position,
      scores.*
    from scores
  )
  select
    r.rank_position,
    r.user_id,
    r.display_name,
    r.handle,
    r.avatar_initials,
    r.total_xp,
    r.current_streak,
    r.longest_streak,
    r.completed_quests
  from ranked r
  order by r.rank_position
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.irlquest_create_submission(
  p_submission_id uuid,
  p_user_id uuid,
  p_proof_session_id uuid,
  p_evidence_path text,
  p_evidence_mime text,
  p_evidence_hash text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.proof_sessions%rowtype;
  v_assignment_status text;
begin
  select ps.*
  into v_session
  from public.proof_sessions ps
  where ps.id = p_proof_session_id and ps.user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROOF_SESSION_NOT_FOUND';
  end if;
  if v_session.used_at is not null then
    raise exception using errcode = 'P0001', message = 'PROOF_SESSION_USED';
  end if;
  if v_session.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'PROOF_SESSION_EXPIRED';
  end if;

  select da.status
  into v_assignment_status
  from public.daily_assignments da
  where da.id = v_session.assignment_id and da.user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_assignment_status not in ('pending', 'rejected', 'review') then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_AVAILABLE';
  end if;
  if exists (
    select 1 from public.submissions s where s.evidence_hash = p_evidence_hash
  ) then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_ALREADY_USED';
  end if;

  insert into public.submissions (
    id, user_id, assignment_id, proof_session_id, evidence_path,
    evidence_mime, evidence_hash, status
  ) values (
    p_submission_id, p_user_id, v_session.assignment_id, p_proof_session_id,
    p_evidence_path, p_evidence_mime, p_evidence_hash, 'pending'
  );

  update public.proof_sessions
  set used_at = now()
  where id = p_proof_session_id;

  update public.daily_assignments
  set status = 'verifying', submission_id = p_submission_id
  where id = v_session.assignment_id;

  return p_submission_id;
end;
$$;

insert into public.quests (
  id, slug, title, prompt, description, category, difficulty, xp,
  icon, accent, capture_tip, verification_rules, cadence, active, state
) values
  (
    'quest_path_view', 'path-view', 'Path view',
    'Find an outdoor path.',
    'Photograph a real outdoor sidewalk, path, or trail.',
    'outdoors', 'easy', 65,
    'Footprints', 'lime',
    'Keep the path easy to see and avoid showing private addresses.',
    '["One real outdoor path, sidewalk, or trail is clearly visible."]'::jsonb,
    'daily', false, 'testing'
  ),
  (
    'quest_open_air_view', 'open-air-view', 'Open-air view',
    'Show the sky and ground together.',
    'Photograph one outdoor scene with real sky and ground both visible.',
    'outdoors', 'easy', 70,
    'CloudSun', 'blue',
    'A yard, park, or quiet street view works; no landmark is needed.',
    '["A real outdoor scene clearly shows both sky and ground."]'::jsonb,
    'daily', false, 'testing'
  ),
  (
    'quest_red_find', 'red-find', 'Red find',
    'Find one red thing.',
    'Photograph one everyday object that is clearly red.',
    'creative', 'easy', 55,
    'Palette', 'coral',
    'Make the red object the main subject.',
    '["One clearly red everyday object is visible."]'::jsonb,
    'daily', false, 'testing'
  ),
  (
    'quest_yellow_find', 'yellow-find', 'Yellow find',
    'Find one yellow thing.',
    'Photograph one everyday object that is clearly yellow.',
    'creative', 'easy', 55,
    'Sun', 'sunset',
    'Make the yellow object the main subject.',
    '["One clearly yellow everyday object is visible."]'::jsonb,
    'daily', false, 'testing'
  ),
  (
    'quest_hand_sign', 'hand-sign', 'Hand sign',
    'Follow the live hand sign.',
    'During capture, make the simple hand gesture shown in your live challenge.',
    'creative', 'easy', 60,
    'Hand', 'violet',
    'Keep your hand fully visible and well lit.',
    '["A clear human hand gesture is visible."]'::jsonb,
    'daily', false, 'testing'
  )
on conflict (id) do update set
  slug = excluded.slug,
  title = excluded.title,
  prompt = excluded.prompt,
  description = excluded.description,
  category = excluded.category,
  difficulty = excluded.difficulty,
  xp = excluded.xp,
  icon = excluded.icon,
  accent = excluded.accent,
  capture_tip = excluded.capture_tip,
  verification_rules = excluded.verification_rules,
  cadence = excluded.cadence,
  state = excluded.state,
  active = excluded.active,
  updated_at = now();

insert into public.quest_versions (
  id, quest_id, version, slug, title, prompt, description, category,
  difficulty, xp, icon, accent, capture_tip, verification_rules
)
select
  q.id || '_v1', q.id, 1, q.slug, q.title, q.prompt, q.description, q.category,
  q.difficulty, q.xp, q.icon, q.accent, q.capture_tip, q.verification_rules
from public.quests q
where q.id in (
  'quest_path_view',
  'quest_open_air_view',
  'quest_red_find',
  'quest_yellow_find',
  'quest_hand_sign'
)
on conflict (id) do nothing;

create or replace function public.irlquest_ensure_assignments(
  p_user_id uuid,
  p_assigned_date date
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quest record;
  v_daily_count integer;
  v_weekly_count integer;
  v_is_tester boolean := exists (
    select 1 from private.quest_testers qt where qt.user_id = p_user_id
  );
  v_week_start date := date_trunc('week', p_assigned_date::timestamp)::date;
begin
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  select count(*)::integer
  into v_daily_count
  from public.daily_assignments da
  join public.quests q on q.id = da.quest_id
  where da.user_id = p_user_id
    and da.assigned_date = p_assigned_date
    and (
      q.state = 'active'
      or (q.state = 'testing' and v_is_tester)
    )
    and q.cadence = 'daily';

  for v_quest in
    select q.id as quest_id, qv.id as quest_version_id
    from public.quests q
    join lateral (
      select v.id
      from public.quest_versions v
      where v.quest_id = q.id
      order by v.version desc
      limit 1
    ) qv on true
    where (
        q.state = 'active'
        or (q.state = 'testing' and v_is_tester)
      )
      and q.cadence = 'daily'
      and not exists (
        select 1
        from public.daily_assignments da
        where da.user_id = p_user_id
          and da.quest_id = q.id
          and da.assigned_date = p_assigned_date
      )
    order by
      case when q.state = 'testing' then 0 else 1 end,
      md5(p_user_id::text || p_assigned_date::text || q.id)
    limit greatest(0, 3 - v_daily_count)
  loop
    insert into public.daily_assignments (
      user_id, quest_id, quest_version_id, assigned_date
    ) values (
      p_user_id, v_quest.quest_id, v_quest.quest_version_id, p_assigned_date
    ) on conflict (user_id, quest_id, assigned_date) do nothing;
  end loop;

  select count(*)::integer
  into v_weekly_count
  from public.daily_assignments da
  join public.quests q on q.id = da.quest_id
  where da.user_id = p_user_id
    and da.assigned_date = v_week_start
    and (
      q.state = 'active'
      or (q.state = 'testing' and v_is_tester)
    )
    and q.cadence = 'weekly';

  for v_quest in
    select q.id as quest_id, qv.id as quest_version_id
    from public.quests q
    join lateral (
      select v.id
      from public.quest_versions v
      where v.quest_id = q.id
      order by v.version desc
      limit 1
    ) qv on true
    where (
        q.state = 'active'
        or (q.state = 'testing' and v_is_tester)
      )
      and q.cadence = 'weekly'
      and not exists (
        select 1
        from public.daily_assignments da
        where da.user_id = p_user_id
          and da.quest_id = q.id
          and da.assigned_date = v_week_start
      )
    order by
      case when q.state = 'testing' then 0 else 1 end,
      md5(p_user_id::text || v_week_start::text || q.id)
    limit greatest(0, 1 - v_weekly_count)
  loop
    insert into public.daily_assignments (
      user_id, quest_id, quest_version_id, assigned_date
    ) values (
      p_user_id, v_quest.quest_id, v_quest.quest_version_id, v_week_start
    ) on conflict (user_id, quest_id, assigned_date) do nothing;
  end loop;
end;
$$;

revoke all on function public.irlquest_is_tester(uuid)
  from public, anon, authenticated;
revoke all on function public.irlquest_take_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.irlquest_claim_maintenance(text, integer)
  from public, anon, authenticated;
revoke all on function public.irlquest_complete_maintenance(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.irlquest_scan_verification_health()
  from public, anon, authenticated;
revoke all on function public.irlquest_leaderboard(integer)
  from public, anon, authenticated;
revoke all on function public.irlquest_create_submission(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.irlquest_ensure_assignments(uuid, date)
  from public, anon, authenticated;

grant execute on function public.irlquest_is_tester(uuid) to service_role;
grant execute on function public.irlquest_take_rate_limit(uuid, text, integer, integer) to service_role;
grant execute on function public.irlquest_claim_maintenance(text, integer) to service_role;
grant execute on function public.irlquest_complete_maintenance(text, jsonb) to service_role;
grant execute on function public.irlquest_scan_verification_health() to service_role;
grant execute on function public.irlquest_leaderboard(integer) to service_role;
grant execute on function public.irlquest_create_submission(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.irlquest_ensure_assignments(uuid, date) to service_role;

commit;
