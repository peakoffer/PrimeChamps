---
description: Commit, push, and create PR with pre-computed context
---

Current git status:
$(git status --short)

Current branch:
$(git branch --show-current)

Files changed:
$(git diff --name-only)

Diff summary:
$(git diff --stat)

Based on the above context, commit all staged and unstaged changes with a clear, descriptive commit message that summarizes what was done. Then push to origin and create a pull request with a title and description that explains the changes, why they were made, and any testing done.

Follow the commit message format:
- Use imperative mood ("Add feature" not "Added feature")
- First line: summary (50 chars max)
- Body: explain what and why (wrap at 72 chars)

For PR description include:
## Summary
- Bullet points of changes

## Test Plan
- How changes were verified

## Notes
- Any additional context
