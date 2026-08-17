-- XP is a production reward, so only a successful full-validator GenLayer
-- result may complete an assignment. Leader-only, local, legacy, timeout,
-- and disagreement outcomes remain retryable and never create an XP event.

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

  if p_status = 'accepted' and (
    p_verification_source is distinct from 'genlayer_consensus'
    or coalesce(p_consensus_status, '') not in ('ACCEPTED', 'FINALIZED')
    or p_transaction_hash is null
    or coalesce(p_verdict ->> 'verifier', '') <> 'genlayer-consensus'
    or coalesce(p_verdict ->> 'verdict', '') <> 'PASS'
    or coalesce(p_verdict ->> 'questSatisfied', 'false') <> 'true'
    or coalesce(p_verdict ->> 'challengeSatisfied', 'false') <> 'true'
    or coalesce(p_verdict ->> 'evidenceClear', 'false') <> 'true'
    or coalesce(p_verdict ->> 'safe', 'false') <> 'true'
  ) then
    raise exception using errcode = 'P0001', message = 'VALIDATOR_CONSENSUS_REQUIRED_FOR_XP';
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

revoke all on function public.irlquest_finalize_submission_v2(uuid, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.irlquest_finalize_submission_v2(uuid, text, jsonb, text, text, text)
  to service_role;

create temporary table irlquest_nonconsensus_accepts on commit drop as
select s.id, s.user_id, s.assignment_id
from public.submissions s
where s.status = 'accepted'
  and (
    s.verification_source is distinct from 'genlayer_consensus'
    or coalesce(s.consensus_status, '') not in ('ACCEPTED', 'FINALIZED')
  );

delete from public.xp_events x
using irlquest_nonconsensus_accepts invalid
where x.submission_id = invalid.id;

update public.daily_assignments da
set status = 'pending',
    submission_id = null,
    updated_at = now()
from irlquest_nonconsensus_accepts invalid
where da.id = invalid.assignment_id
  and da.submission_id = invalid.id;

update public.submissions s
set status = 'review',
    verdict = jsonb_build_object(
      'verdict', 'REVIEW',
      'questSatisfied', false,
      'challengeSatisfied', false,
      'evidenceClear', false,
      'safe', true,
      'reasonCode', 'GENLAYER_CONSENSUS_REQUIRED',
      'summary', 'Couldn''t verify this one.',
      'verifier', 'genlayer-network'
    ),
    consensus_status = coalesce(s.consensus_status, 'CONSENSUS_NOT_PROVEN'),
    processing_lease_until = null,
    verified_at = now()
from irlquest_nonconsensus_accepts invalid
where s.id = invalid.id;

with affected_users as (
  select distinct user_id
  from irlquest_nonconsensus_accepts
),
valid_days as (
  select distinct s.user_id, da.assigned_date
  from public.submissions s
  join public.daily_assignments da on da.id = s.assignment_id
  join affected_users affected on affected.user_id = s.user_id
  where s.status = 'accepted'
    and s.verification_source = 'genlayer_consensus'
    and s.consensus_status in ('ACCEPTED', 'FINALIZED')
),
numbered_days as (
  select
    user_id,
    assigned_date,
    assigned_date - (row_number() over (
      partition by user_id order by assigned_date
    ))::integer as streak_group
  from valid_days
),
streaks as (
  select
    user_id,
    min(assigned_date) as start_date,
    max(assigned_date) as end_date,
    count(*)::integer as length
  from numbered_days
  group by user_id, streak_group
),
streak_summary as (
  select
    affected.user_id,
    coalesce(max(streaks.length), 0)::integer as longest_streak,
    max(streaks.end_date) as last_completed_date
  from affected_users affected
  left join streaks on streaks.user_id = affected.user_id
  group by affected.user_id
),
profile_stats as (
  select
    summary.user_id,
    coalesce(current_streak.length, 0)::integer as current_streak,
    summary.longest_streak,
    summary.last_completed_date
  from streak_summary summary
  left join streaks current_streak
    on current_streak.user_id = summary.user_id
   and current_streak.end_date = summary.last_completed_date
)
update public.profiles profile
set current_streak = stats.current_streak,
    longest_streak = stats.longest_streak,
    last_completed_date = stats.last_completed_date,
    updated_at = now()
from profile_stats stats
where profile.id = stats.user_id;

do $$
begin
  if exists (
    select 1
    from public.submissions s
    join public.xp_events x on x.submission_id = s.id
    where s.verification_source is distinct from 'genlayer_consensus'
       or coalesce(s.consensus_status, '') not in ('ACCEPTED', 'FINALIZED')
  ) then
    raise exception 'Non-consensus XP remained after reconciliation';
  end if;
end;
$$;
