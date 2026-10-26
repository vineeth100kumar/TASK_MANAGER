# Notes for Claude

- Start with [CODEMAP.md](CODEMAP.md): where every folder, feature, API route,
  config value and test lives. Update it when you add or move any of those.
- The Pi deploys `claude/project-thread-clc1ti` (its `SAGE_BRANCH`), not `main`.
  Open PRs against that branch.
- Checks before a PR: `npm run typecheck`, `npm test`, `npm run build`, and
  `cd raspberry_pi && python -m unittest discover -s tests`.
