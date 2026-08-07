# Prime Champs Research Agent v2

## Operating model

The research agent has one job: return a small, evidence-backed set of athletes worth human review. It never sends outreach.

Prime Champs maintains one active recruiting thesis per workspace. A research run pins the exact thesis version it used, so later edits cannot silently change an old run.

## Weekly intelligence loop

1. Add the Zac + Dylan meeting as a recording or pasted transcript.
2. OpenAI diarizes uploaded audio. Pasted transcripts skip this step.
3. The latest available Claude Sonnet extracts conservative, evidence-linked proposals.
4. An owner or admin approves or rejects every proposal.
5. Publishing creates a new immutable recruiting-thesis version. It never mutates an older version.

Audio is stored in a private 25 MB Supabase bucket. AI output cannot update the active thesis without human review, and a quoted evidence reference must match text in the underlying transcript segment.

## Research run

The launcher intentionally exposes only three choices:

- Sport
- Optional market override
- Standard or Extended depth

Standard targets up to 10 qualified finalists. Extended targets up to 20 and runs two distinct discovery waves:

1. Current competition evidence, breakout results, roster promotions, and early professional momentum.
2. Rising personal audiences, creator-led content, overlooked leagues, and recent media momentum.

The workflow then executes durable, retryable stages:

1. **Discovery:** Perplexity Search returns raw ranked results. The latest Sonnet may extract a candidate only when an exact returned URL supports that athlete's professional status. Apify Google Search is the source-grounded fallback.
2. **Identity and enrichment:** Apify resolves the athlete's Instagram identity and batches public profile enrichment.
3. **Signals:** Supabase records a dated audience snapshot. The first snapshot is explicitly a baseline; follower growth is claimed only after a later snapshot exists.
4. **Scoring:** The latest available Claude Sonnet scores the candidate against the pinned thesis and the fixed scoring rubric.
5. **Disposition:** Qualified, source-verified adults can enter Approval. Unknown-age candidates remain held in Research. Minors, identity conflicts, weak fits, veterans, and unsafe records cannot enter Approval.

## Gates and scoring

These are hard gates, not weighted preferences:

- Athlete and Instagram identity resolve to the same real person.
- Current professional status has direct or reputable evidence.
- Age is source-verified as 18 or older before Approval.
- Instagram is public and active.

Candidates that pass the gates are scored:

- Momentum: 25%
- Creator/business fit: 25%
- Audience quality and measured growth: 20%
- Accessibility: 15%
- Active-thesis match: 15%

The Approval threshold is 75. Scores from 60 through 74 are watchlist/hold quality. The agent never pads a result set with weak candidates just to reach 10 or 20.

## Provider responsibilities

- **Perplexity Search:** current ranked web discovery, at low per-request cost.
- **Apify:** Google identity lookup and Instagram profile enrichment.
- **Anthropic:** latest-Sonnet extraction and scoring.
- **OpenAI:** speaker-aware meeting-audio transcription only.
- **Supabase:** versioned thesis, evidence ledger, durable run state, private audio, candidates, and signal history.
- **Vercel Workflow:** long-running stages, retries, and resumability.

Modash is deliberately not part of v2. Prime Champs first builds its own signal history with the APIs already available; Modash should be reconsidered only if measured candidate quality or operating volume justifies its annual contract.

## Safety boundary

Research can create or update records in Research and Approval. It does not generate an external side effect: no email, Instagram message, LinkedIn message, or other outreach is sent from a research run.
