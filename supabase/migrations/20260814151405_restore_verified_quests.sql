begin;

-- These quests each produced an accepted GenLayer result in production. Keep
-- them in the rotation so the catalog retains outdoor, shape, and close-up
-- variety alongside the simpler object-finding quests.
update public.quests
set active = true,
    updated_at = now()
where id in (
  'quest_golden_hour',
  'quest_found_face',
  'quest_tiny_wonder'
);

commit;
