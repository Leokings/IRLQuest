-- Production migration version: 20260814164818
-- Keep Close-up in testing while its verification criteria are evaluated.
begin;

update public.quests
set state = 'testing',
    updated_at = now()
where id = 'quest_tiny_wonder';

commit;
