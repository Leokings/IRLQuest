begin;

create index if not exists verification_alerts_submission_id_idx
  on private.verification_alerts (submission_id);

create index if not exists verification_alerts_quest_id_idx
  on private.verification_alerts (quest_id);

commit;
