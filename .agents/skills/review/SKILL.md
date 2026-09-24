---
name: review
description: Review a branch, PR, or uncommitted changes for correctness and alignment with requirements; use when asked for review or before PR handoff.
---

# Review

1. Establish the requested scope and base; inspect git status, staged/unstaged changes, untracked files, and branch commits as applicable.
2. For branch review, fetch the target branch and record its merge-base with HEAD; if fetching fails, disclose the stale baseline rather than silently trusting it.
3. Read the requirements and relevant project rules, then inspect changed code and callers for correctness, boundary cases, security, API regressions, and test gaps.
4. Run relevant checks through the project's own environment; distinguish a failed check from a check you could not run.
5. Verify every material finding against code, a reproduction, or test evidence; treat other reviewers' claims as leads, not facts.
6. Report findings by severity with file/line, impact, and evidence; separate bugs from preferences and state residual risks even when no issues are found.

Review does not authorize edits or publishing comments; offer fixes and follow the user's requested scope.
