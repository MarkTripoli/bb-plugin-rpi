---
name: rpi-create-research-questions
description: Run for /rpi-create-research-questions requests. Draft a neutral query plan for the research phase.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Research Planning Phase

You draft a research-questions artifact: a short query plan that lets the next session document the repository, dependencies, and surrounding systems as they exist now. Turn the user's request and allowed inputs into questions that drive objective discovery, not design.

## Steps

1. **Read inputs fully**. Read references/research_questions_template.md and references/research_questions_final_answer.md from this skill's directory. Read `task.md` or `ticket.md` from the task directory, files the user named with `@...`, and collateral docs the user tells you to use. Do not inspect unrelated artifacts. Capture exact pointers: URLs, docs links, issue/ticket/PR refs, repo names, local paths, package names, SDKs, frameworks, services, file paths, dirs, commands, schemas, tables, endpoints, component names. Preserve these pointers exactly in the artifact. Do not normalize or paraphrase paths, package names, issue keys, or URLs.

2. **Light context pass**. Spawn child threads only when they quickly orient the question set. Keep shallow; next phase does real research. Use `rpi-agent-codebase-locator` (find files, dirs, tests, docs, config, entry points), `rpi-agent-codebase-analyzer` (explain current data flow or behavior for a narrow area), `rpi-agent-codebase-pattern-finder` (find existing examples and conventions), `rpi-agent-web-search-researcher` (external docs for dependencies, APIs, protocols, modern libraries). Prefer one to four children. Skip if the ticket gives enough context.

3. **Draft questions**. Write questions a researcher can answer by inspecting the existing codebase, docs, tests, dependency references. Questions reveal how things work now, not what the implementation should become. Match the number of questions to the task. At least two questions, under eight unless unusually broad or the user asked for a larger plan. Strong questions point at likely evidence without leaking the intended change: "In `packages/ui`, how are modal actions wired from trigger to state update?" Weak questions ask the researcher to design: "How should we add X?" Do not ask how to build the feature, propose approaches, suggest improvements/cleanup/refactors/optimizations, disclose the desired solution, or frame as "should we" or "how would we". Do ask what exists and where, how modules/services/components/data/events/commands/tests connect, current contracts, edge cases, failure paths, permissions, config, state transitions, codebase conventions, dependencies or external API usage.

## Output

Follow references/research_questions_template.md. Fill **Key Context Pointers** when the input gives concrete links, packages, repos, dependencies, files, dirs, commands, endpoints, or issue refs. Omit only when truly none. Call `rpi_next_artifact_number`, use `NN-research-questions-<2-4-word-kebab>.md`. Respond using references/research_questions_final_answer.md only. Fill the template fields, include the artifact directive, and do not add extra prose before or after it. End with exactly one fenced `text` block containing `/rpi-create-research`. Do not invent cloud URLs.

If the request could touch frontend behavior, UI components, product screens, visual assets, HTML prototypes, theming, accessibility, or interaction design, include design-system discovery: which design system/component library/token layer, color tokens or literal colors (hex values), typography, spacing, radius, elevation, layout, responsive conventions, theming hooks, CSS variables, framework utilities, visual regression assets. This design-system topic is required for possible frontend work even when the ticket's UI details are vague. It exists so later mockups and implementation can match the product rather than inventing a one-off style.
