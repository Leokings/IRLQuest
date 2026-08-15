begin;

update public.quests as q
set
  slug = d.slug,
  title = d.title,
  prompt = d.prompt,
  description = d.description,
  category = d.category,
  difficulty = d.difficulty,
  xp = d.xp,
  capture_tip = d.capture_tip,
  verification_rules = d.verification_rules
from (
  values
    (
      'quest_golden_hour', 'sky-snap', 'Sky snap',
      'Point up and snap the sky.',
      'Take a photo with a clear patch of real sky.',
      'outdoors', 'easy', 60,
      'Any daytime or evening sky works.',
      '["A real outdoor sky is clearly visible."]'::jsonb
    ),
    (
      'quest_found_face', 'round-thing', 'Round thing',
      'Find one thing that is round.',
      'Photograph one everyday object that is clearly round.',
      'creative', 'easy', 80,
      'Keep the round object easy to see.',
      '["One everyday object with a clearly round shape is visible."]'::jsonb
    ),
    (
      'quest_touch_grass', 'green-thing', 'Green thing',
      'Find one green leaf or plant.',
      'Photograph one clearly green leaf or plant.',
      'wellbeing', 'easy', 40,
      'A houseplant or an outdoor plant both count.',
      '["One clearly green leaf or plant is visible."]'::jsonb
    ),
    (
      'quest_color_hunt', 'blue-find', 'Blue find',
      'Find one blue thing.',
      'Photograph one everyday object that is clearly blue.',
      'creative', 'easy', 70,
      'Make the blue object the main subject.',
      '["One clearly blue everyday object is visible."]'::jsonb
    ),
    (
      'quest_balance_act', 'small-stack', 'Small stack',
      'Put one safe thing on top of another.',
      'Stack two safe household objects and take a photo.',
      'maker', 'easy', 100,
      'Use light, unbreakable objects.',
      '["Two separate safe household objects are visibly stacked.", "The stack is not being held by a person."]'::jsonb
    ),
    (
      'quest_tiny_wonder', 'close-up', 'Close-up',
      'Take a closer look.',
      'Photograph one small everyday object up close.',
      'creative', 'easy', 75,
      'Keep the object centered and in focus.',
      '["One small everyday object is clearly visible in a close-up photo."]'::jsonb
    ),
    (
      'quest_shadow_story', 'shadow-snap', 'Shadow snap',
      'Find one clear shadow.',
      'Photograph any clear shadow on a wall, floor, or the ground.',
      'weekly', 'easy', 250,
      'Any object or hand can make the shadow.',
      '["One clear real-world shadow is visible on a surface."]'::jsonb
    )
) as d(
  id, slug, title, prompt, description, category, difficulty, xp,
  capture_tip, verification_rules
)
where q.id = d.id;

insert into public.quest_versions (
  id, quest_id, version, slug, title, prompt, description, category,
  difficulty, xp, icon, accent, capture_tip, verification_rules
)
select
  q.id || '_v2', q.id, 2, q.slug, q.title, q.prompt, q.description, q.category,
  q.difficulty, q.xp, q.icon, q.accent, q.capture_tip, q.verification_rules
from public.quests q
where q.id in (
  'quest_golden_hour',
  'quest_found_face',
  'quest_touch_grass',
  'quest_color_hunt',
  'quest_balance_act',
  'quest_tiny_wonder',
  'quest_shadow_story'
)
on conflict (id) do nothing;

update public.daily_assignments as da
set quest_version_id = da.quest_id || '_v2'
where da.status = 'pending'
  and da.quest_version_id <> da.quest_id || '_v2'
  and exists (
    select 1
    from public.quest_versions qv
    where qv.id = da.quest_id || '_v2'
  )
  and not exists (
    select 1
    from public.proof_sessions ps
    where ps.assignment_id = da.id
      and ps.used_at is null
      and ps.expires_at > now()
  )
  and not exists (
    select 1
    from public.submissions s
    where s.assignment_id = da.id
      and s.status = 'pending'
  );

commit;
