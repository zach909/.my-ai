# Git Workflow Policy

- `main` is the only long-lived branch.
- When a change is needed, open it as a pull request: create exactly one branch for that PR, and delete the branch once the PR merges (or closes). Don't create branches "just in case" or leave extra branches sitting around unmerged.
- Don't create sub-branches off of other topic branches — branch from `main`, merge back into `main`.
- Never push directly to `main`; all changes land through a reviewed pull request.
