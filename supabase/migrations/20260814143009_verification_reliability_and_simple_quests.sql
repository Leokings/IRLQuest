-- Production migration version: 20260814143009
begin;

alter table public.submissions
  add column if not exists verification_source text,
  add column if not exists consensus_status text,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists processing_lease_until timestamptz;

alter table public.submissions
  drop constraint if exists submissions_verification_source_check,
  add constraint submissions_verification_source_check check (
    verification_source is null
    or verification_source in (
      'genlayer_consensus',
      'genlayer_leader_fallback',
      'local_demo',
      'none',
      'legacy'
    )
  ),
  drop constraint if exists submissions_consensus_status_check,
  add constraint submissions_consensus_status_check check (
    consensus_status is null or consensus_status ~ '^[A-Z][A-Z_]{1,39}$'
  ),
  drop constraint if exists submissions_processing_attempts_check,
  add constraint submissions_processing_attempts_check check (processing_attempts >= 0);

update public.submissions
set verification_source = case
  when verdict ->> 'verifier' = 'local-demo' then 'local_demo'
  when transaction_hash is not null then 'legacy'
  else 'none'
end
where status <> 'pending'
  and verification_source is null;

create index if not exists submissions_pending_recovery_idx
  on public.submissions (processing_lease_until, created_at)
  where status = 'pending';

create or replace function public.irlquest_claim_submission(
  p_submission_id uuid,
  p_user_id uuid,
  p_unrelayed_lease_seconds integer default 60,
  p_hashed_lease_seconds integer default 145
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  if p_unrelayed_lease_seconds not between 15 and 180
    or p_hashed_lease_seconds not between 15 and 180 then
    raise exception using errcode = 'P0001', message = 'INVALID_PROCESSING_LEASE';
  end if;

  update public.submissions as s
  set
    processing_attempts = s.processing_attempts + 1,
    processing_lease_until = clock_timestamp() + make_interval(
      secs => case
        when s.transaction_hash is null then p_unrelayed_lease_seconds
        else p_hashed_lease_seconds
      end
    )
  where s.id = p_submission_id
    and s.user_id = p_user_id
    and s.status = 'pending'
    and (
      s.processing_lease_until is null
      or s.processing_lease_until <= clock_timestamp()
    )
  returning s.processing_attempts into v_attempt;

  return coalesce(v_attempt, 0);
end;
$$;

create or replace function public.irlquest_finalize_submission_v2(
  p_submission_id uuid,
  p_status text,
  p_verdict jsonb,
  p_transaction_hash text,
  p_verification_source text,
  p_consensus_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_submission record;
  v_profile public.profiles%rowtype;
  v_streak integer;
begin
  if p_status not in ('accepted', 'rejected', 'review') then
    raise exception using errcode = 'P0001', message = 'INVALID_SUBMISSION_STATUS';
  end if;
  if p_verification_source is not null and p_verification_source not in (
    'genlayer_consensus',
    'genlayer_leader_fallback',
    'local_demo',
    'none',
    'legacy'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_VERIFICATION_SOURCE';
  end if;
  if p_consensus_status is not null
    and p_consensus_status !~ '^[A-Z][A-Z_]{1,39}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_CONSENSUS_STATUS';
  end if;

  select
    s.user_id,
    s.assignment_id,
    s.status,
    da.quest_id,
    da.assigned_date,
    qv.xp,
    qv.title
  into v_submission
  from public.submissions s
  join public.daily_assignments da on da.id = s.assignment_id
  join public.quest_versions qv on qv.id = da.quest_version_id
  where s.id = p_submission_id
  for update of s, da;

  if not found then
    raise exception using errcode = 'P0001', message = 'SUBMISSION_NOT_FOUND';
  end if;
  if v_submission.status <> 'pending' then
    return;
  end if;

  update public.submissions
  set
    status = p_status,
    verdict = p_verdict,
    transaction_hash = p_transaction_hash,
    verification_source = p_verification_source,
    consensus_status = p_consensus_status,
    processing_lease_until = null,
    verified_at = now()
  where id = p_submission_id;

  if p_status = 'accepted' then
    update public.daily_assignments
    set status = 'completed', submission_id = p_submission_id
    where id = v_submission.assignment_id;

    insert into public.xp_events (
      user_id, submission_id, quest_id, amount, reason
    ) values (
      v_submission.user_id,
      p_submission_id,
      v_submission.quest_id,
      v_submission.xp,
      'Completed ' || v_submission.title
    ) on conflict (submission_id) do nothing;

    select p.*
    into v_profile
    from public.profiles p
    where p.id = v_submission.user_id
    for update;

    if v_profile.last_completed_date = v_submission.assigned_date then
      v_streak := v_profile.current_streak;
    elsif v_profile.last_completed_date = v_submission.assigned_date - 1 then
      v_streak := v_profile.current_streak + 1;
    else
      v_streak := 1;
    end if;

    update public.profiles
    set
      current_streak = v_streak,
      longest_streak = greatest(v_streak, v_profile.longest_streak),
      last_completed_date = v_submission.assigned_date
    where id = v_submission.user_id;
  else
    update public.daily_assignments
    set status = 'pending', submission_id = null
    where id = v_submission.assignment_id;
  end if;
end;
$$;

revoke all on function public.irlquest_claim_submission(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.irlquest_finalize_submission_v2(uuid, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.irlquest_claim_submission(uuid, uuid, integer, integer)
  to service_role;
grant execute on function public.irlquest_finalize_submission_v2(uuid, text, jsonb, text, text, text)
  to service_role;

update public.quests
set active = false,
    updated_at = now()
where id in (
  'quest_golden_hour',
  'quest_found_face',
  'quest_balance_act',
  'quest_tiny_wonder'
);

insert into public.quests (
  id, slug, title, prompt, description, category, difficulty, xp,
  icon, accent, capture_tip, verification_rules, cadence, active
) values
  (
    'quest_cup_find', 'cup-find', 'Cup find',
    'Find a cup or mug.',
    'Photograph one clearly recognizable cup or mug.',
    'everyday', 'easy', 50,
    'CupSoda', 'coral',
    'Place it down so the whole cup is easy to see.',
    '["One clearly recognizable cup or mug is visible."]'::jsonb,
    'daily', true
  ),
  (
    'quest_pen_find', 'pen-find', 'Pen find',
    'Find a pen or pencil.',
    'Photograph one clearly recognizable pen or pencil.',
    'everyday', 'easy', 55,
    'PenLine', 'violet',
    'Place it on a plain surface.',
    '["One clearly recognizable pen or pencil is visible."]'::jsonb,
    'daily', true
  ),
  (
    'quest_book_find', 'book-find', 'Book find',
    'Find a book.',
    'Photograph one clearly recognizable book.',
    'everyday', 'easy', 65,
    'BookOpen', 'blue',
    'An open or closed book works.',
    '["One clearly recognizable book is visible."]'::jsonb,
    'daily', true
  ),
  (
    'quest_bottle_find', 'bottle-find', 'Bottle find',
    'Find a drink bottle.',
    'Photograph one clearly recognizable drink bottle.',
    'everyday', 'easy', 60,
    'Milk', 'aqua',
    'Place the bottle upright if you can.',
    '["One clearly recognizable drink bottle is visible."]'::jsonb,
    'daily', true
  ),
  (
    'quest_spoon_find', 'spoon-find', 'Spoon find',
    'Find a spoon.',
    'Photograph one clearly recognizable spoon.',
    'everyday', 'easy', 45,
    'Utensils', 'sunset',
    'Place it on a surface with a different color.',
    '["One clearly recognizable spoon is visible."]'::jsonb,
    'daily', true
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
  active = true,
  updated_at = now();

insert into public.quest_versions (
  id, quest_id, version, slug, title, prompt, description, category,
  difficulty, xp, icon, accent, capture_tip, verification_rules
)
select
  q.id || '_v2', q.id, 2, q.slug, q.title, q.prompt, q.description, q.category,
  q.difficulty, q.xp, q.icon, q.accent, q.capture_tip, q.verification_rules
from public.quests q
where q.id in (
  'quest_cup_find',
  'quest_pen_find',
  'quest_book_find',
  'quest_bottle_find',
  'quest_spoon_find'
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
    and q.active
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
    where q.active
      and q.cadence = 'daily'
      and not exists (
        select 1
        from public.daily_assignments da
        where da.user_id = p_user_id
          and da.quest_id = q.id
          and da.assigned_date = p_assigned_date
      )
    order by md5(p_user_id::text || p_assigned_date::text || q.id)
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
    and q.active
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
    where q.active
      and q.cadence = 'weekly'
      and not exists (
        select 1
        from public.daily_assignments da
        where da.user_id = p_user_id
          and da.quest_id = q.id
          and da.assigned_date = v_week_start
      )
    order by md5(p_user_id::text || v_week_start::text || q.id)
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

commit;
