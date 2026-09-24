# thingy

A blank repo with a small, portable agent-assisted development workflow.
No app, language, dependency manager configuration, or CI is selected yet.

## Use it

1. Choose **Use this template** on GitHub to start a project.
2. Replace this README with the project's purpose and setup instructions.
3. Choose a stack and add one local check entry point before wiring it into CI.
4. Adjust `AGENTS.md` to match how you want to work.

## What's here

- [`AGENTS.md`](AGENTS.md): short rules for session start, development, GitHub, and handoff.
- [`.agents/skills/`](.agents/skills): small planning, review, and issue-triage workflows,
  plus `grill-me`, `grilling`, `domain-modeling`, `codebase-design`, and
  `diagnosing-bugs` with their reference files and debugging script.
- `.gitignore`: common local secrets, environments, caches, and build output.

Agents that discover `.agents/skills` can load these skills directly; other
agents can follow the links in `AGENTS.md`. No harness-specific tools are required.
GitHub operations use `gh` with authentication to the destination repository.
The five additional design/debugging skills come from the owner's shared skill
collection; missing-skill links and delegation requirements were made portable.

## What was trimmed

Adapted from the development workflows in
[goldilocks-core](https://github.com/stfc/goldilocks-core): catchup, reporting,
testing, documentation, GitHub CLI, Python tooling, and PR handoff became short
rules instead of separate skills. Planning, review, and triage retain ordered steps.
Scientific guidance, release infrastructure, mandatory milestones, and the
skill-authoring manual are omitted. No Goldilocks application code is included.

These are agent instructions, not enforced branch protection or CI checks.
The adapted material retains its BSD-3-Clause notice in [`LICENSE`](LICENSE).
