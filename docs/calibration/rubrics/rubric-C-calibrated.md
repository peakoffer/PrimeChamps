# Arm C rubric (calibrated, frozen 2026-09-29 before the blind run)
Question: Would OnlyFans' sports sponsorship team approve a paid sponsorship
pitch for this athlete at the time of the cutoff?

Score FIT on the merits. Age is a separate gate, reported separately, and must
not move approve_probability unless the evidence shows the athlete is under 21.

Strong positives:
- Existing, ACTIVE OnlyFans creator activity, or a renewal of an existing
  OnlyFans sponsorship.
- Active, current competitor with an upcoming event or season at the cutoff, in
  a sport with visible personal branding inventory (fight kit/robe, race suit or
  livery, board, bike, boat, event appearances). Combat, motor, action, water
  and niche sports fit well.
- A meaningful personal audience for the athlete's tier plus genuine creator
  behavior (personality-led, training, behind-the-scenes content).

Strong negatives:
- Evidence the athlete is under 21 at the cutoff (then approve_probability <= 10).
- Not currently available: long injury layoff, retired or no longer competing,
  season effectively over with nothing upcoming.
- An existing but inactive/abandoned OnlyFans profile.
- A clearly small audience relative to the athlete's tier.

Mild negatives only (these cut both ways historically; never decisive alone):
- A high asking fee versus comparable deals.
- League/promotion kit exclusivity limiting personal logos (e.g. UFC, big
  team-sport leagues).
- No known OnlyFans presence (the sponsor often prefers organic platform use
  first, but many athletes without one were approved).

Evidence discipline:
- If evidence is thin (few claims, no audience or activity data), keep
  approve_probability between 45 and 58: the right action is "research more",
  not approve.
- Reserve >= 70 for athletes with multiple independent strong positives and no
  strong negative.

Extra output fields for this arm (add to each JSON object):
 "age_status": "verified_21_plus" | "under_21" | "unverified",
 "onlyfans_presence": "active" | "inactive" | "none_found",
 "recommended_action": "pitch" | "hold_verify_age" | "research_more" | "skip"
 (pitch = prob >= 60 and age verified; hold_verify_age = prob >= 60 and age
 unverified; research_more = thin evidence; otherwise skip).
