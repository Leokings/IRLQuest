-- Production migration version: 20260814164818
-- The production-only row correction associated with this migration was completed before
-- the repository snapshot. Its old transaction identifiers are intentionally not retained.
-- Fresh environments need only the durable quest-state change below; the later consensus
-- migration applies the generic XP and verdict safeguards without transaction allowlists.
begin;

update public.quests
set state = 'testing',
    updated_at = now()
where id = 'quest_tiny_wonder';

commit;
