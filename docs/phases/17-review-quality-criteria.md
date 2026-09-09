# Phase 17: Review quality criteria

## What shipped

- Expanded `rpi-review-code` into an explicit five-axis review covering correctness, readability and simplicity, architecture, security, and performance.
- Added a tests-first inspection order, an overall code-health approval standard, and Critical, Required, Optional, Nit, and FYI classifications.
- Kept the repair loop bounded: only Critical and Required findings force `rpi-fix-code-review`; non-blocking advisories can coexist with a clean review.
- Added structural remedy guidance, change and file sizing signals, dead-code handling, dependency review, and verification-story checks.
- Expanded the review artifact to preserve the five assessments, change profile, verification evidence, blocking findings, advisories, dependency and dead-code review, and final verdict.
- Updated the fix skill and repair receipt so advisories cannot silently become mandatory work.

## Verification

- `python3 .../skill-creator/scripts/quick_validate.py skills/rpi-review-code`
  - `Skill is valid!`
- `python3 .../skill-creator/scripts/quick_validate.py skills/rpi-fix-code-review`
  - `Skill is valid!`
- `npm test`
  - `tests 242`, `pass 242`, `fail 0`.
  - Includes the review-artifact structure check and the third-party shingle guard.
- `bb plugin build`
  - Built the server and app bundles successfully.

## Deviations and decisions

- The supplied skill was distilled rather than copied. Generic timing guidance and cross-skill links were omitted because they do not change an RPI review session's code verdict.
- Line-count thresholds are inspection signals, not automatic blockers. The review still covers the complete pinned scope and requests a split only for incoherent scope or an active structural regression.
- A clean review may retain Optional, Nit, or FYI notes. This preserves the stated standard that healthy improvement can be approved without demanding perfection.

## Reviewer checklist

- Run one review with a Required finding and confirm it routes to `rpi-fix-code-review`.
- Run one clean review with an Optional advisory and confirm it routes to `rpi-describe-pr`.
- Confirm the repair artifact records advisory choices separately from required finding dispositions.
