---
name: show-me
description: Visual guidance for concise diagrams, code-shape sketches, and focused HTML artifacts.
---

Use the smallest visual that explains the current decision. Keep prose short and put the visual beside the text it supports.

- Use pseudocode for logic.
- Use call trees for runtime flow.
- Use component trees for UI structure.
- Use file trees for ownership.
- Use Mermaid for sequence, data flow, or control flow.
- Use diff blocks when the point is what changes.
- Use a focused HTML artifact when annotations, layout, or side-by-side comparison are clearer than markdown.

Example file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

Example task artifact embed:

```task-artifact
.humanlayer/tasks/{task-slug}/show-me-{description}.html
```
