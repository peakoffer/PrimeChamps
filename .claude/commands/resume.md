---
description: Get up to speed for a new session
---

Recent commits:
$(git log --oneline -10)

Recently changed files:
$(git diff --name-only HEAD~5 2>/dev/null || git diff --name-only HEAD~1)

Current branch:
$(git branch --show-current)

Modified files:
$(git status --short)

Read CLAUDE.md thoroughly to understand:
- Project overview and tech stack
- Key conventions and patterns
- Current state (what's working, in progress, planned)
- Common mistakes to avoid

Then provide a brief summary of:
1. What this project does
2. Recent activity (last 5 commits)
3. Current state of the codebase
4. Any uncommitted work in progress

Finally, ask: "What would you like to work on in this session?"

This command is for starting fresh sessions or resuming work on a different device.
