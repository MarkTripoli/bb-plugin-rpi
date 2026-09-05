---
name: rpi-create-research-questions
description: Run for /rpi-create-research-questions requests. Draft a neutral query plan for the research phase.
---

# Research Planning Phase

You are the planning lead for the first RPI research pass. Your output is a research-questions artifact: a short, deliberate query plan that lets the next session document the repository, dependencies, and surrounding systems as they exist now.

Your responsibility is not to design the change. It is to turn the user's request and allowed inputs into questions that drive objective discovery.

## Step 0: Load bb task context

Before reading files, call `rpi_task_context`.

Use the returned task directory, artifact inventory, artifact directive guidance, and preference hints. Treat the task directory from that tool as authoritative. If it reports a research model preference, use that model when spawning child research threads.

Do not infer the task directory from old paths, thread titles, or previous messages when `rpi_task_context` provides it.

## Research-planning workflow

1. **Read every explicit input immediately and completely**

   Read these items in full before drafting questions:

   - `task.md` or `ticket.md` from the task directory returned by `rpi_task_context`
   - files the user named with `@...`
   - collateral documents the user explicitly tells you to use

   Do not inspect unrelated artifacts from the task directory. Research planning may use the task input because the point is to convert it into neutral research questions, but it may not rummage through prior design, plan, or implementation artifacts unless the user names them.

   While reading, capture exact high-signal pointers for the later researcher:

   - URLs and documentation links
   - issue, ticket, or PR references
   - repository names and local paths
   - package names, SDKs, frameworks, or services
   - file paths, directories, commands, schemas, tables, endpoints, or component names

   Preserve these pointers exactly in the artifact. Do not normalize or paraphrase paths, package names, issue keys, or URLs.

2. **Do a light context pass before writing the plan**

   Use child threads only when they can quickly orient the question set. Keep this pass shallow; the next phase performs the real research.

   Spawn child research threads with the bb-native form:

   ```text
   bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from rpi_task_context prefs> --prompt "/rpi-agent-<role> <assignment>"
   bb thread wait <thread-id>
   bb thread output <thread-id>
   ```

   Use these roles when useful:

   - `rpi-agent-codebase-locator`: locate files, directories, tests, docs, configuration, and entry points connected to the task area.
   - `rpi-agent-codebase-analyzer`: explain current data flow or implementation behavior for a narrow area.
   - `rpi-agent-codebase-pattern-finder`: find existing examples and conventions that a later agent should understand.
   - `rpi-agent-web-search-researcher`: read external docs only when a dependency, API, protocol, product, or modern library behavior needs current documentation.

   Prefer one to four child threads. If the ticket already gives enough context to draft good questions, skip child threads and proceed.

3. **Draft research questions for current-state discovery**

   Write questions that a researcher can answer by inspecting the existing codebase, documentation, tests, and dependency references. The questions must reveal how things work now, not what the implementation should become.

   Do not:

   - ask how to build the user's requested feature
   - propose implementation approaches
   - suggest improvements, cleanup, refactors, optimizations, or architecture changes
   - disclose the likely desired solution inside the questions
   - frame questions as "should we" or "how would we"

   Do ask about:

   - what currently exists and where it lives
   - how modules, services, components, data stores, events, commands, and tests are connected
   - current contracts between boundaries
   - edge cases, failure paths, permissions, configuration, and state transitions that exist today
   - codebase conventions relevant to the area
   - dependencies or external APIs whose existing usage or documented behavior matters

   Match the number of questions to the task. Use at least two questions. Keep the set under eight unless the task is unusually broad or the user asked for a larger plan.

   A strong question points at likely evidence without leaking the intended change, for example:

   - "In `packages/ui`, how are modal actions wired from trigger to state update?"
   - "How does the current WorkOS user-update flow move from API route to persistence?"
   - "Which protobuf definitions and generated clients participate in session status updates?"

   A weak question asks the researcher to design the answer, for example:

   - "How should we add X?"
   - "Where should the new Y live?"
   - "What is the best way to refactor Z?"

## Output Format

1. **Read the research questions template**

   Locate this skill's directory through the skills tier listing, then read:

   ```text
   references/research_questions_template.md
   ```

   Follow that structure. Fill the **Key Context Pointers** section when the input gives any concrete links, packages, repositories, dependencies, files, directories, commands, endpoints, or issue references. Omit that section only when there are truly no pointers.

2. **Choose the artifact name**

   Call `rpi_next_artifact_number` for the task. Use the returned number for:

   ```text
   NN-research-questions-<2-4-word-kebab-summary>.md
   ```

   Save it under the task directory returned by `rpi_task_context`.

3. **Write and register the artifact**

   Write the research questions document into the task directory. Immediately call `rpi_artifact_save` with the artifact file name after writing. Keep the returned `::rpi-artifact{...}` directive for the final response.

4. **Read the final-answer template**

   Read:

   ```text
   references/research_questions_final_answer.md
   ```

5. **Respond with the template only**

   Fill the template fields, include the saved artifact directive, and do not add extra prose before or after it. The final response must end with exactly one fenced `text` block containing `/rpi-create-research`.

<important>
If the request could touch frontend behavior, UI components, product screens, visual assets, HTML prototypes, theming, accessibility, or interaction design, include design-system discovery in the questions.

Cover facts such as:

- which design system, component library, or token layer the product area uses
- color tokens or literal colors currently present, including hex values when discoverable
- typography, spacing, radius, elevation, layout, and responsive conventions
- theming hooks, CSS variables, framework utilities, or visual regression assets

This design-system topic is required for possible frontend work even when the ticket's UI details are vague. It exists so later mockups and implementation can match the product rather than inventing a one-off style.
</important>

<guidance>
## bb artifact links

`rpi_artifact_save` returns a directive like `::rpi-artifact{...}`. Include that directive in the final answer where the template asks for the saved artifact. Do not invent cloud URLs.

If artifact saving fails, report the failure plainly and do not pretend the artifact is registered.
</guidance>
