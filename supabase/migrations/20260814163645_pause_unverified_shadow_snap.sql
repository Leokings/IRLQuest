begin;

update public.quests
set state = 'paused',
    updated_at = now()
where id = 'quest_shadow_story';

commit;
