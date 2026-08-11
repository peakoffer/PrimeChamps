set lock_timeout = '5s';
set statement_timeout = '90s';

create index if not exists research_evidence_preparation_runs_requester_idx
  on public.research_evidence_preparation_runs(requested_by_user_id)
  where requested_by_user_id is not null;
