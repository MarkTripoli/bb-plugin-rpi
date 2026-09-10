# Phase 22: Semantic history gate

## Shipped behavior

- Pull-request titles and every commit subject in the pull-request range must follow `type(scope)!: description`.
- The validator uses Node and Git already available in CI, with no new dependency.
- The GitHub workflow runs for pull-request title edits, new commits, reopened pull requests, ready-for-review transitions, and merge queue checks.
- `AGENTS.md` records the same rule for local agent work.
- The `main` branch requires the workflow check before merging.

## Verification

- `node --test tests/conventional-commits.test.mjs`
- `PR_TITLE='feat: make manual RPI launches reviewable' npm run check:conventional`
- `npm test`
- `bb plugin build`
- GitHub check run on pull request #6
- GitHub branch protection for `main`

## Deviations and open items

- The policy validates pull-request commits and titles. GitHub-generated merge commit subjects are outside the pull-request range.
- Existing history is not rewritten; enforcement starts with pull requests after this workflow lands.
