SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE INDEX message_drafts_channel_account_idx
  ON public.message_drafts (channel_account_id)
  WHERE channel_account_id IS NOT NULL;
