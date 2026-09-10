# Phase 22: Semantic history gate

## Shipped behavior

- Pull-request titles and every commit subject in the pull-request range must follow `type(scope)!: description`.
- The validator uses Node and Git already available in CI, with no new dependency.
- The GitHub workflow runs for pull-request title edits, new commits, reopened pull requests, ready-for-review transitions, and merge queue checks.
- `AGENTS.md` records the same rule for local agent work.
- The `main` branch requires the workflow check before merging.

## Verification

- `node --test tests/conventional-commits.test.mjs`: 2 passed, 0 failed.
- `PR_TITLE='feat: make manual RPI launches reviewable' npm run check:conventional`: validated the title and current commit range.
- `npm test`: 271 passed, 0 failed, including typecheck.
- `bb plugin types --check`: project and host SDK 0.4.34 match.
- `bb plugin build`: passed with only the existing Node `module.register()` deprecation warning.
- [GitHub Actions run 34488636882](https://github.com/MarkTripoli/bb-plugin-rpi/actions/runs/34488636882): passed on commit `ba8b6e4`.
- [Repository ruleset 22780300](https://github.com/MarkTripoli/bb-plugin-rpi/rules/22780300): active on the default branch with no bypass actors and requires `Conventional commits and PR title` from GitHub Actions.

## Deviations and open items

- The policy validates pull-request commits and titles. GitHub-generated merge commit subjects are outside the pull-request range.
- Existing history is not rewritten; enforcement starts with pull requests after this workflow lands.
