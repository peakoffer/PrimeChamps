---
description: Pull latest and check for conflicts
---

$(git fetch origin)
$(git status)

Pull the latest changes from main branch, check for any merge conflicts, and report the current state.

Steps:
1. Fetch latest from origin
2. Check if current branch is behind
3. If behind, pull and merge
4. Report any conflicts with specific files affected
5. If conflicts exist, explain how to resolve them
6. Show summary of what changed

If there are no conflicts, confirm the branch is up to date and ready for work.
