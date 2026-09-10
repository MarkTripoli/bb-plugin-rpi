---
name: rpi-show-me
description: Run for /rpi-show-me requests. Explain the current topic visually with compact diagrams or a focused HTML artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Show Me

Explain topic through smallest useful visual. Place visual next to point it explains. Use for explanation, not implementation.

If user named artifact with `@...`, read fully. If about current conversation only, use context and avoid opening unrelated task files.

## Choose smallest visual

Pseudocode for algorithms. Call tree for runtime order. Component tree for UI and state. File tree for ownership. Mermaid when relationships or flow matter. `diff` only when before/after is the point; when most of the shape is new, show the complete target block instead.

## HTML artifact

Create HTML when text diagrams insufficient: UI layout, state comparison, dense map, or concept needing responsive rendering.

Read `references/show_me_template.md` for structure. Keep self-contained, focused, responsive, safe. Match product's colors, typography, spacing, components when known. Use real labels and data when task materials provide them. For numbered, call `rpi_next_artifact_number` and name `NN-show-me-<2-4-word-kebab>.html` or `.md`.

## Rules

No artifact when inline diagram answers. No unrelated artifacts. No essay before visual. No decorative diagrams. No invented styles when design system available. No implementation plans unless asked. No staging, committing, modifying source.

## Final response

If saved artifact, read `references/show_me_final_answer.md`, use that template only, include directive, end with exactly one fenced `text` block containing `/rpi-show-me`. If no artifact, answer with visual and no next-step command.
