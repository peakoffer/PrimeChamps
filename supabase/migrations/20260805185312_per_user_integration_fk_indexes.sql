SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE INDEX organizations_created_by_user_id_idx
  ON public.organizations(created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
CREATE INDEX profiles_default_organization_id_idx
  ON public.profiles(default_organization_id)
  WHERE default_organization_id IS NOT NULL;
CREATE INDEX organization_memberships_invited_by_user_id_idx
  ON public.organization_memberships(invited_by_user_id)
  WHERE invited_by_user_id IS NOT NULL;
CREATE INDEX channel_messages_sent_by_user_id_idx
  ON public.channel_messages(sent_by_user_id)
  WHERE sent_by_user_id IS NOT NULL;
CREATE INDEX channel_audit_events_actor_user_id_idx
  ON public.channel_audit_events(actor_user_id)
  WHERE actor_user_id IS NOT NULL;
