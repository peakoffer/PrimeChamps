-- Owner-controlled automated Instagram first DMs. Off by default; sends only
-- approved messages, at most daily_dm_limit per 24 hours, inside the window.
insert into public.outreach_settings (key, value, description) values
  ('auto_send_instagram', 'false'::jsonb, 'Owner switch: automatically send approved first DMs from the connected Instagram account'),
  ('send_window_start_hour', '9'::jsonb, 'Automated DMs start at this local hour'),
  ('send_window_end_hour', '20'::jsonb, 'Automated DMs stop at this local hour'),
  ('send_timezone', '"America/New_York"'::jsonb, 'Time zone for the sending window')
on conflict (key) do nothing;

-- Lower the historical 50/day default to a cautious 15/day; keep any owner-set value.
update public.outreach_settings
set value = '15'::jsonb, updated_at = now(), description = 'Maximum automated Instagram DMs per 24 hours (hard cap 30)'
where key = 'daily_dm_limit' and value = '50'::jsonb;
