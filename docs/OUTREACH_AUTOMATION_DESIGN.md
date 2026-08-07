# Outreach operating model

## Goal

Let the operator spend time on real replies instead of repeatedly checking profiles. Prime Champs should prepare relevant outreach, watch for responses, and surface the next best action without silently contacting anyone.

## Current safety mode

- Research never sends outreach.
- AI generation creates editable drafts only.
- Email, Instagram, and Resend sends are blocked server-side unless `OUTBOUND_SEND_ENABLED=true` is deliberately set later.
- Comments use manual reminders, not an automatic publisher.
- Every future live-send capability needs an organization setting, a user-owned connected account, approval rules, and an audit event.

## Recommended campaign flow

1. **Qualify** — a verified adult candidate clears research and Approval.
2. **Build plan** — AI prepares one initial DM, a small set of post-specific comments, and suggested follow-up dates.
3. **Human approval** — the operator edits and approves the whole plan or individual steps.
4. **Create tasks** — a daily workflow makes due work visible. In the current mode it never sends.
5. **Watch responses** — email or Instagram webhooks attach replies to the athlete and immediately pause future steps.
6. **Refresh context** — when a new public post is detected, AI may prepare a new comment draft using that post only.
7. **Stop cleanly** — response, rejection, opt-out, contract, manual pause, or cadence limit ends the campaign.

## Product states

`Drafted → Approved → Due → Manually completed → Responded / Paused / Completed`

Only after live sending is intentionally enabled should `Due → Sent` be allowed automatically. That should be opt-in per organization, per channel, and per campaign—not a global surprise switch.

## Templates versus AI

Use **playbooks**, not canned final messages. A playbook defines tone, claims that are allowed, claims that are forbidden, length, call to action, cadence, and a few successful examples. AI writes the athlete-specific draft from current evidence. Store the model, prompt/playbook version, evidence used, edits, send event, and outcome so performance can improve without pretending one static template caused the result.

## Data needed

- `outreach_campaigns`: athlete, owner, status, goal, playbook version, stop reason.
- `outreach_steps`: channel, order, due rule, draft, approval, completion/send status.
- `outreach_tasks`: the operator’s daily due queue.
- `post_watch_events`: new-post evidence and any resulting comment draft.
- `contact_suppression`: opt-outs, do-not-contact status, and channel restrictions.
- Existing channel messages and touchpoints remain the source of truth for replies and completed outreach.

## Daily workflow

The durable scheduler should:

1. find active campaigns with a due step;
2. stop campaigns that received a reply or reached a guardrail;
3. refresh only the public data needed for the next step;
4. generate or refresh a draft;
5. create one operator task;
6. record the decision and evidence;
7. send nothing while draft-only mode is active.

## Channel priority

1. **Instagram** — primary athlete channel once Meta approval and eligible DM sync are stable.
2. **Email / Microsoft Exchange** — reliable inbox sync, human-reviewed replies, and clear ownership.
3. **LinkedIn** — worthwhile as an assisted research, drafting, and manual-send workflow; direct messaging access is restricted.
4. **X** — lowest priority until actual athlete response data shows it is worth the integration and API cost.

## Measurement

Track the smallest useful funnel by owner, sport, channel, and playbook version: candidates approved, first contacts completed, replies, qualified conversations, appointments, and signed deals. Do not rank a playbook until it has enough completed sends to be meaningful.
