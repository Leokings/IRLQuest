begin;

grant usage on schema private to service_role;
grant select on private.quest_testers to service_role;
grant select, insert, update, delete on private.action_rate_limits to service_role;
grant select, insert, update on private.maintenance_runs to service_role;
grant select, insert, update, delete on private.verification_alerts to service_role;

commit;
