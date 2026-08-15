begin;

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  avatar_url text,
  avatar_initials text not null check (char_length(avatar_initials) between 1 and 3),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= current_streak),
  last_completed_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quests (
  id text primary key,
  slug text not null unique,
  title text not null,
  prompt text not null,
  description text not null,
  category text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard', 'legendary')),
  xp integer not null check (xp > 0),
  icon text not null,
  accent text not null,
  capture_tip text not null,
  verification_rules jsonb not null check (
    jsonb_typeof(verification_rules) = 'array'
    and jsonb_array_length(verification_rules) between 1 and 8
  ),
  cadence text not null default 'daily' check (cadence in ('daily', 'weekly')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quest_versions (
  id text primary key,
  quest_id text not null references public.quests(id) on delete restrict,
  version integer not null check (version > 0),
  slug text not null,
  title text not null,
  prompt text not null,
  description text not null,
  category text not null,
  difficulty text not null,
  xp integer not null check (xp > 0),
  icon text not null,
  accent text not null,
  capture_tip text not null,
  verification_rules jsonb not null,
  created_at timestamptz not null default now(),
  unique (quest_id, version)
);

create table public.daily_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quest_id text not null references public.quests(id) on delete restrict,
  quest_version_id text not null references public.quest_versions(id) on delete restrict,
  assigned_date date not null,
  status text not null default 'pending' check (
    status in ('pending', 'verifying', 'completed', 'rejected', 'review')
  ),
  submission_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, quest_id, assigned_date)
);

create table public.proof_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.daily_assignments(id) on delete cascade,
  nonce text not null unique,
  challenge text not null check (char_length(challenge) between 10 and 240),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table public.submissions (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.daily_assignments(id) on delete cascade,
  proof_session_id uuid not null unique references public.proof_sessions(id) on delete restrict,
  evidence_path text not null unique,
  evidence_mime text not null check (evidence_mime in ('image/jpeg', 'image/png', 'image/webp')),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'review')),
  verdict jsonb,
  transaction_hash text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.daily_assignments
  add constraint daily_assignments_submission_id_fkey
  foreign key (submission_id) references public.submissions(id) on delete set null;

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  submission_id uuid unique references public.submissions(id) on delete restrict,
  quest_id text references public.quests(id) on delete restrict,
  amount integer not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create index daily_assignments_user_date_idx
  on public.daily_assignments (user_id, assigned_date);
create index daily_assignments_quest_id_idx
  on public.daily_assignments (quest_id);
create index daily_assignments_quest_version_id_idx
  on public.daily_assignments (quest_version_id);
create index daily_assignments_submission_id_idx
  on public.daily_assignments (submission_id)
  where submission_id is not null;
create index proof_sessions_user_created_idx
  on public.proof_sessions (user_id, created_at desc);
create index proof_sessions_assignment_id_idx
  on public.proof_sessions (assignment_id);
create index submissions_user_created_idx
  on public.submissions (user_id, created_at desc);
create index submissions_assignment_id_idx
  on public.submissions (assignment_id);
create index xp_events_user_created_idx
  on public.xp_events (user_id, created_at desc);
create index xp_events_quest_id_idx
  on public.xp_events (quest_id)
  where quest_id is not null;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger quests_set_updated_at
before update on public.quests
for each row execute function private.set_updated_at();

create trigger assignments_set_updated_at
before update on public.daily_assignments
for each row execute function private.set_updated_at();

insert into public.quests (
  id, slug, title, prompt, description, category, difficulty, xp, icon,
  accent, capture_tip, verification_rules, cadence, active
) values
  (
    'quest_golden_hour', 'golden-hour', 'Golden hour',
    'Catch the sky putting on a show.',
    'Photograph a real sunset with the horizon and warm sky clearly visible.',
    'outdoors', 'easy', 60, 'Sunset', 'sunset',
    'Keep the horizon in frame and avoid pointing directly at the sun.',
    '["A real outdoor sunset or late golden-hour sky is clearly visible.", "The horizon or surrounding outdoor context is present.", "The image is not a photo of another screen, print, or artwork."]'::jsonb,
    'daily', true
  ),
  (
    'quest_found_face', 'found-a-face', 'Found a face',
    'Spot a face hiding in everyday things.',
    'Find an ordinary object whose shapes naturally resemble a face.',
    'creative', 'medium', 80, 'ScanFace', 'violet',
    'Frame the object closely enough that its accidental expression is obvious.',
    '["One ordinary, non-living object is the main subject.", "Features of the object plausibly resemble two eyes and a mouth or face shape.", "The face is found in the object, not drawn or digitally added."]'::jsonb,
    'daily', true
  ),
  (
    'quest_touch_grass', 'touch-grass', 'Touch grass',
    'A tiny reset, verified by nature.',
    'Show one hand safely touching living grass outdoors.',
    'wellbeing', 'easy', 40, 'Sprout', 'lime',
    'Use a public or familiar safe space. Never enter private property for a quest.',
    '["Living grass is clearly visible in an outdoor setting.", "A human hand is visibly touching the grass.", "The scene does not show trespassing, traffic danger, or another obvious hazard."]'::jsonb,
    'daily', true
  ),
  (
    'quest_color_hunt', 'color-hunt', 'Color hunt',
    'Three finds. One color. One frame.',
    'Arrange three different everyday objects that share one dominant color.',
    'creative', 'medium', 70, 'Palette', 'blue',
    'Choose objects that are clearly different, not three copies of one item.',
    '["At least three distinct objects appear together in one image.", "All three objects share a clearly recognizable dominant color.", "The objects are physically present rather than assembled digitally."]'::jsonb,
    'daily', true
  ),
  (
    'quest_balance_act', 'balance-act', 'Balance act',
    'Build something that should probably fall.',
    'Stack four safe household objects into one free-standing tower.',
    'maker', 'hard', 100, 'Blocks', 'coral',
    'Use light, unbreakable objects on a clear surface.',
    '["At least four separate household objects form one connected stack.", "The stack is free-standing and not visibly held by a person.", "No dangerous, sharp, burning, or fragile objects are used."]'::jsonb,
    'daily', true
  ),
  (
    'quest_tiny_wonder', 'tiny-wonder', 'Tiny wonder',
    'Notice something most people walk past.',
    'Capture a naturally tiny detail outdoors: a seed, insect, texture, or new leaf.',
    'outdoors', 'medium', 75, 'Sparkles', 'aqua',
    'Get close without disturbing wildlife or damaging a living thing.',
    '["A small natural subject or detail is the clear focal point.", "The subject appears in a real outdoor environment.", "No animal or plant is visibly harmed or disturbed."]'::jsonb,
    'daily', true
  ),
  (
    'quest_shadow_story', 'shadow-story', 'Shadow story',
    'Turn a shadow into a character.',
    'Use natural light and your hands or safe objects to create a recognizable creature-shaped shadow.',
    'weekly', 'legendary', 250, 'Rabbit', 'ink',
    'Sunlight near a plain wall works beautifully. Keep faces and private details out of frame.',
    '["A deliberate shadow is the main subject of the image.", "The shadow plausibly resembles an animal or imaginary creature.", "The effect is produced with physical light and objects, not digital drawing."]'::jsonb,
    'weekly', true
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
  active = excluded.active;

insert into public.quest_versions (
  id, quest_id, version, slug, title, prompt, description, category,
  difficulty, xp, icon, accent, capture_tip, verification_rules
)
select
  q.id || '_v1', q.id, 1, q.slug, q.title, q.prompt, q.description, q.category,
  q.difficulty, q.xp, q.icon, q.accent, q.capture_tip, q.verification_rules
from public.quests q
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
  v_week_start date := date_trunc('week', p_assigned_date::timestamp)::date;
begin
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

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
    where q.active and q.cadence = 'daily'
    order by md5(p_user_id::text || p_assigned_date::text || q.id)
    limit 3
  loop
    insert into public.daily_assignments (
      user_id, quest_id, quest_version_id, assigned_date
    ) values (
      p_user_id, v_quest.quest_id, v_quest.quest_version_id, p_assigned_date
    ) on conflict (user_id, quest_id, assigned_date) do nothing;
  end loop;

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
    where q.active and q.cadence = 'weekly'
    order by md5(p_user_id::text || v_week_start::text || q.id)
    limit 1
  loop
    insert into public.daily_assignments (
      user_id, quest_id, quest_version_id, assigned_date
    ) values (
      p_user_id, v_quest.quest_id, v_quest.quest_version_id, v_week_start
    ) on conflict (user_id, quest_id, assigned_date) do nothing;
  end loop;
end;
$$;

create or replace function public.irlquest_create_proof_session(
  p_user_id uuid,
  p_assignment_id uuid,
  p_nonce text,
  p_challenge text,
  p_expires_at timestamptz
)
returns table (
  session_id uuid,
  assignment_id uuid,
  challenge text,
  expires_at timestamptz,
  session_code text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_session_id uuid := gen_random_uuid();
begin
  select da.status
  into v_status
  from public.daily_assignments da
  where da.id = p_assignment_id and da.user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_status not in ('pending', 'rejected', 'review') then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_NOT_AVAILABLE';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION_EXPIRY';
  end if;

  insert into public.proof_sessions (
    id, user_id, assignment_id, nonce, challenge, expires_at
  ) values (
    v_session_id, p_user_id, p_assignment_id, p_nonce, p_challenge, p_expires_at
  );

  return query select
    v_session_id,
    p_assignment_id,
    p_challenge,
    p_expires_at,
    upper(substr(p_nonce, 1, 5));
end;
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

create or replace function public.irlquest_finalize_submission(
  p_submission_id uuid,
  p_status text,
  p_verdict jsonb,
  p_transaction_hash text default null
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

revoke all on function public.irlquest_ensure_assignments(uuid, date)
  from public, anon, authenticated;
revoke all on function public.irlquest_create_proof_session(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.irlquest_create_submission(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.irlquest_finalize_submission(uuid, text, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.irlquest_ensure_assignments(uuid, date) to service_role;
grant execute on function public.irlquest_create_proof_session(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.irlquest_create_submission(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.irlquest_finalize_submission(uuid, text, jsonb, text) to service_role;

alter table public.profiles enable row level security;
alter table public.quests enable row level security;
alter table public.quest_versions enable row level security;
alter table public.daily_assignments enable row level security;
alter table public.proof_sessions enable row level security;
alter table public.submissions enable row level security;
alter table public.xp_events enable row level security;

create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy quests_read_active
on public.quests for select
to anon, authenticated
using (active);

create policy quest_versions_read_active
on public.quest_versions for select
to anon, authenticated
using (
  exists (
    select 1 from public.quests q
    where q.id = quest_versions.quest_id and q.active
  )
);

create policy daily_assignments_select_own
on public.daily_assignments for select
to authenticated
using ((select auth.uid()) = user_id);

create policy proof_sessions_select_own
on public.proof_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy submissions_select_own
on public.submissions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy xp_events_select_own
on public.xp_events for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.quests from anon, authenticated;
revoke all on table public.quest_versions from anon, authenticated;
revoke all on table public.daily_assignments from anon, authenticated;
revoke all on table public.proof_sessions from anon, authenticated;
revoke all on table public.submissions from anon, authenticated;
revoke all on table public.xp_events from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant select on table public.quests, public.quest_versions to anon, authenticated;
grant select on table public.profiles, public.daily_assignments, public.proof_sessions,
  public.submissions, public.xp_events to authenticated;
grant update (display_name, handle, avatar_url) on table public.profiles to authenticated;

grant all on table public.profiles, public.quests, public.quest_versions,
  public.daily_assignments, public.proof_sessions, public.submissions,
  public.xp_events to service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'quest-evidence',
  'quest-evidence',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
