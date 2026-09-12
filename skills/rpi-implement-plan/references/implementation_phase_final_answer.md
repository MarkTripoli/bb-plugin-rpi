Phase {completed_phase} automated checks are green.

Review artifact:
{artifact_directive}

Check:
- {review_check}
- Known limits: {known_limits}

Deferred human evidence (recorded, not executed):
- {evidence item and pointer, or None}

Implementation continues to Phase {next_phase} automatically. This command re-enters the skill with the same plan if the run is interrupted.

```text
/rpi-implement-plan{artifact_arg}
```
