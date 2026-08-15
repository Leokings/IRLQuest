begin;

update public.quests
set state = 'active',
    updated_at = now()
where id = 'quest_shadow_story';

commit;
