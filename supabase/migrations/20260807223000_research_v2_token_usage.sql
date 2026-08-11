-- Research V2 token accounting. Provider currency cost remains separate because
-- model prices can change independently of immutable run records.

alter table public.research_scores
  add column if not exists input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column if not exists output_tokens bigint not null default 0 check (output_tokens >= 0),
  add column if not exists cache_creation_input_tokens bigint not null default 0 check (cache_creation_input_tokens >= 0),
  add column if not exists cache_read_input_tokens bigint not null default 0 check (cache_read_input_tokens >= 0);

alter table public.research_audits
  add column if not exists input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column if not exists output_tokens bigint not null default 0 check (output_tokens >= 0),
  add column if not exists cache_creation_input_tokens bigint not null default 0 check (cache_creation_input_tokens >= 0),
  add column if not exists cache_read_input_tokens bigint not null default 0 check (cache_read_input_tokens >= 0);

alter table public.research_benchmark_runs
  add column if not exists input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column if not exists output_tokens bigint not null default 0 check (output_tokens >= 0),
  add column if not exists cache_creation_input_tokens bigint not null default 0 check (cache_creation_input_tokens >= 0),
  add column if not exists cache_read_input_tokens bigint not null default 0 check (cache_read_input_tokens >= 0);

alter table public.research_benchmark_results
  add column if not exists input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column if not exists output_tokens bigint not null default 0 check (output_tokens >= 0),
  add column if not exists cache_creation_input_tokens bigint not null default 0 check (cache_creation_input_tokens >= 0),
  add column if not exists cache_read_input_tokens bigint not null default 0 check (cache_read_input_tokens >= 0);

comment on column public.research_audits.input_tokens is
  'Combined non-cached input tokens consumed by the blind assessment and score-review stages.';
