-- Production migration version: 20260814164818
-- Correct legacy rows that were marked accepted before a contract result existed.
-- Genuine GenLayer PASS results for Blue find, Round thing, and Sky snap are not touched.
begin;

do $$
declare
  v_submission_count integer;
  v_assignment_count integer;
  v_xp_count integer;
begin
  select count(*)
  into v_submission_count
  from public.submissions s
  where s.transaction_hash in (
    '0xbc6329571cf8d6e47c8d85b0b1b29d8cabf84d856718742bada239ac60874d2d',
    '0xe36393b5d3c60ccf6404e34e0569d52f9e4a3081003c5c4f2c1b2a5a95875efb',
    '0xaccc872185949ac6b85f15a76efbb0069cae5db2ff4d4e4461d3f3040b1e295a',
    '0x7e4f1c60f233d80f0a8c95382229985ca94908c80e2c3fe0b7d2f53dc557dcba',
    '0xfdf213d9aa373d2dab15e6dd37c31375a2b2187321ca2b1635423db56e25750c',
    '0x8d7f4c7a6322bc480cf000e0c8652f29f1e689d84e9d78cf213b424870bfa89e'
  )
    and s.status = 'accepted'
    and s.verification_source = 'legacy'
    and s.transaction_hash is not null;

  if v_submission_count <> 6 then
    raise exception 'Expected 6 legacy accepted submissions, found %', v_submission_count;
  end if;

  select count(*)
  into v_assignment_count
  from public.daily_assignments da
  where da.submission_id in (
    select s.id
    from public.submissions s
    where s.transaction_hash in (
      '0xe36393b5d3c60ccf6404e34e0569d52f9e4a3081003c5c4f2c1b2a5a95875efb',
      '0xfdf213d9aa373d2dab15e6dd37c31375a2b2187321ca2b1635423db56e25750c',
      '0xaccc872185949ac6b85f15a76efbb0069cae5db2ff4d4e4461d3f3040b1e295a'
    )
  )
    and da.status = 'completed';

  if v_assignment_count <> 3 then
    raise exception 'Expected 3 completed legacy assignments, found %', v_assignment_count;
  end if;

  select count(*)
  into v_xp_count
  from public.xp_events x
  join public.submissions s on s.id = x.submission_id
  where (s.transaction_hash, x.amount) in (
    ('0xe36393b5d3c60ccf6404e34e0569d52f9e4a3081003c5c4f2c1b2a5a95875efb', 70),
    ('0xfdf213d9aa373d2dab15e6dd37c31375a2b2187321ca2b1635423db56e25750c', 250),
    ('0xaccc872185949ac6b85f15a76efbb0069cae5db2ff4d4e4461d3f3040b1e295a', 75)
  );

  if v_xp_count <> 3 then
    raise exception 'Expected 3 invalid XP events, found %', v_xp_count;
  end if;

  if not exists (
    select 1
    from public.quests q
    where q.id = 'quest_tiny_wonder'
      and q.state = 'active'
  ) then
    raise exception 'Close-up was not active before correction';
  end if;
end;
$$;

update public.quests
set state = 'testing',
    updated_at = now()
where id = 'quest_tiny_wonder';

delete from public.xp_events x
using public.submissions s
where s.id = x.submission_id
  and (s.transaction_hash, x.amount) in (
  ('0xe36393b5d3c60ccf6404e34e0569d52f9e4a3081003c5c4f2c1b2a5a95875efb', 70),
  ('0xfdf213d9aa373d2dab15e6dd37c31375a2b2187321ca2b1635423db56e25750c', 250),
  ('0xaccc872185949ac6b85f15a76efbb0069cae5db2ff4d4e4461d3f3040b1e295a', 75)
);

update public.submissions
set status = 'review',
    verdict = jsonb_build_object(
      'verdict', 'REVIEW',
      'questSatisfied', false,
      'challengeSatisfied', false,
      'evidenceClear', false,
      'safe', true,
      'reasonCode', 'NO_ONCHAIN_RESULT',
      'summary', 'Couldn''t verify this one.',
      'verifier', 'data-audit'
    ),
    verification_source = 'none',
    consensus_status = 'NO_ONCHAIN_RESULT',
    processing_lease_until = null
where transaction_hash in (
  '0xbc6329571cf8d6e47c8d85b0b1b29d8cabf84d856718742bada239ac60874d2d',
  '0xe36393b5d3c60ccf6404e34e0569d52f9e4a3081003c5c4f2c1b2a5a95875efb',
  '0xaccc872185949ac6b85f15a76efbb0069cae5db2ff4d4e4461d3f3040b1e295a',
  '0x7e4f1c60f233d80f0a8c95382229985ca94908c80e2c3fe0b7d2f53dc557dcba',
  '0xfdf213d9aa373d2dab15e6dd37c31375a2b2187321ca2b1635423db56e25750c',
  '0x8d7f4c7a6322bc480cf000e0c8652f29f1e689d84e9d78cf213b424870bfa89e'
)
  and status = 'accepted'
  and verification_source = 'legacy';

update public.daily_assignments
set status = 'review',
    updated_at = now()
where submission_id in (
  select s.id
  from public.submissions s
  where s.transaction_hash in (
    '0xe36393b5d3c60ccf6404e34e0569d52f9e4a3081003c5c4f2c1b2a5a95875efb',
    '0xfdf213d9aa373d2dab15e6dd37c31375a2b2187321ca2b1635423db56e25750c',
    '0xaccc872185949ac6b85f15a76efbb0069cae5db2ff4d4e4461d3f3040b1e295a'
  )
)
  and status = 'completed';

commit;
