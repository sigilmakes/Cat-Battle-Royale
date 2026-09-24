# Working agreements

This is a blank starter; choose the stack before adding application tooling.

## Workflow

- At session start, check git status, the active branch, relevant issues/PRs, and recent handoff comments before repeating work.
- Use feature branches and PRs after initial bootstrap; commit, push, and merge only when the user requests those actions.
- Use Conventional Commits and stage only the intended changes; preserve unrelated work.
- Humans write PR descriptions; hand off the branch, commit summary, diff stat, and issue link rather than drafting a body.
- Use `gh` for GitHub, verify the target repository, and pass long Markdown through `--body-file`.
- Preserve other people's GitHub text; use comments for progress and edit only your own text when the current plan changes.
- Mark agent-authored issues and comments with `Written by an agent on behalf of <user>.`, substituting the requesting human.
- At handoff, record outcomes, decisions, checks, blockers, branch/push state, and the next action on the relevant issue, or in chat if none exists.
- Confirm destructive actions and recoverability before proceeding.

## Development

- Prefer domain modules with small public interfaces; add abstractions or compatibility layers only for a concrete requirement.
- Validate external inputs at boundaries and surface failures rather than hiding them behind catch-all fallbacks.
- Test observable behavior, edge cases, and regressions with portable fixtures; demonstrate that a regression test fails without the fix.
- Use the project's environment and declared commands; for Python, use `uv` rather than global installs.
- Give each check one runnable entry point that local development and CI share, and report checks that were not run.
- Keep docs concise and consistent with implemented behavior; keep command details in their executable source of truth.

## On-demand skills

Read the matching skill before these workflows:
- Planning a feature or refactor: [.agents/skills/plan/SKILL.md](.agents/skills/plan/SKILL.md).
- Reviewing changes: [.agents/skills/review/SKILL.md](.agents/skills/review/SKILL.md).
- Consolidating the issue board: [.agents/skills/triage/SKILL.md](.agents/skills/triage/SKILL.md).
- Stress-testing an idea: [.agents/skills/grilling/SKILL.md](.agents/skills/grilling/SKILL.md) (manual shortcuts: `grill-me`, or [grill-with-docs](.agents/skills/grill-with-docs/SKILL.md) to capture glossary terms and ADRs as you go).
- Sharpening domain language or recording decisions: [.agents/skills/domain-modeling/SKILL.md](.agents/skills/domain-modeling/SKILL.md).
- Designing module interfaces: [.agents/skills/codebase-design/SKILL.md](.agents/skills/codebase-design/SKILL.md).
- Debugging failures or performance regressions: [.agents/skills/diagnosing-bugs/SKILL.md](.agents/skills/diagnosing-bugs/SKILL.md).
