---
description: Run code-simplifier on recent changes
---

Review and simplify the code that was just written or modified.

Recently modified files:
$(git diff --name-only)

Focus on:
1. **Removing unnecessary complexity** - Are there simpler ways to achieve the same result?
2. **Improving readability** - Can variable names be clearer? Can logic be more obvious?
3. **Consolidating duplicate logic** - Any repeated patterns that should be extracted?
4. **Ensuring consistent patterns** - Does the code match existing project conventions?

Rules:
- Do NOT change functionality
- Only improve code quality and readability
- Keep changes minimal and focused
- Preserve existing tests
- Follow the conventions in CLAUDE.md

If using the code-simplifier agent/plugin, invoke it now. Otherwise, review the changed files manually and suggest improvements.
