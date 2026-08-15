begin;

update public.quests
set active = false,
    updated_at = now()
where id = 'quest_shadow_story';

insert into public.quests (
  id, slug, title, prompt, description, category, difficulty, xp,
  icon, accent, capture_tip, verification_rules, cadence, active
) values (
  'quest_wearable_find',
  'wearable-find',
  'Wearable find',
  'Find one thing you can wear.',
  'Photograph one clearly recognizable wearable item.',
  'weekly',
  'easy',
  250,
  'Rabbit',
  'ink',
  'A shoe, hat, or shirt works.',
  '["One clearly recognizable shoe, hat, shirt, or other wearable item is visible."]'::jsonb,
  'weekly',
  true
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
) values (
  'quest_wearable_find_v2',
  'quest_wearable_find',
  2,
  'wearable-find',
  'Wearable find',
  'Find one thing you can wear.',
  'Photograph one clearly recognizable wearable item.',
  'weekly',
  'easy',
  250,
  'Rabbit',
  'ink',
  'A shoe, hat, or shirt works.',
  '["One clearly recognizable shoe, hat, shirt, or other wearable item is visible."]'::jsonb
)
on conflict (id) do nothing;

update public.daily_assignments as da
set quest_id = 'quest_wearable_find',
    quest_version_id = 'quest_wearable_find_v2',
    updated_at = now()
where da.quest_id = 'quest_shadow_story'
  and da.status = 'pending'
  and not exists (
    select 1
    from public.submissions s
    where s.assignment_id = da.id
  )
  and not exists (
    select 1
    from public.proof_sessions ps
    where ps.assignment_id = da.id
      and ps.used_at is null
      and ps.expires_at > now()
  );

commit;
