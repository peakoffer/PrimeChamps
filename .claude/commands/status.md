---
description: Show current project state and next steps
---

Git status:
$(git status --short)

Recent commits:
$(git log --oneline -5)

Current branch:
$(git branch --show-current)

Read CLAUDE.md and provide:

1. **Current Project State**
   - What's the overall status?
   - Any uncommitted changes?

2. **Recently Completed**
   - What do the recent commits show was done?

3. **In Progress**
   - Any modified files not yet committed?
   - What appears to be actively worked on?

4. **Recommended Next Steps**
   - Based on CLAUDE.md "Current State" section
   - What should be tackled next?

5. **Blockers or Issues**
   - Any failing tests?
   - Any merge conflicts?
   - Missing dependencies?

Keep the summary concise but actionable.
