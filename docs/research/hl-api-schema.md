
## tasks create

```
Usage: humanlayer api tasks create [options]

Options:
  --id [string]                                        Stable client-generated task identity; may identify the caller's existing draft for promotion
  --name <string>                                      [required] The name/title of the task; Min length: 1
  --default-working-directory [string]                 Default working directory for sessions in this task
  --workspace-state [json]                             Point-in-time workspace snapshot for worktree:now tasks (repos, descriptions, refs, branches, primary); Object (json formatted); Required: ["workspaceBaseDirectory","repos"]
  --workspace-spec [json]                              Portable desired workspace setup for any host; Object (json formatted); Required: ["directory","workspaceBaseDirectory","repos"]
  --workspace-setup-state [json]                       Finished setup ledger supplied only when the client already materialized the workspace; Object (json formatted); Required: ["specVersion","repos"]
  --local-workspace-base-directory [string]            Expanded absolute workspace root on the creator's machine, recorded in their task_user_settings row
  --host-id [string]                                   Host ID of the creator's machine where the workspace was materialized
  --setup-status [string]                              Initial setup status (choices: "pending", "in_progress", "completed", "failed")
  --workflow-type [string]                             Workflow type selected for this task (choices: "rpi", "outline_only", "prd_tdd", "oneshot", "freeform")
  --worktree-timing [string]                           Worktree timing selected for this task (choices: "now", "later", "never")
  --auto-advance-questions-to-research [boolean]       Auto-advance from research-questions to research on session completion
  --auto-advance-research-to-design [boolean]          Auto-advance from research to design-discussion on session completion
  --auto-advance-plan-to-worktree [boolean]            Auto-advance from plan to worktree setup on session completion
  --auto-advance-worktree-to-implementation [boolean]  Auto-advance from worktree setup to implementation on session completion
  --auto-advance-implementation-to-pr [boolean]        Auto-advance from implementation to PR description on session completion
  --slug [string]                                      URL-friendly slug for the task
  --ticket-content [string]                            Inline ticket.md content for V2 clients; ignored when a ticket provider import is requested
  --task-content [string]                              V3 composer prompt written to task.md. Combined with a provider-named ticket artifact reference when a ticket is attached
  --ticket-artifact-name [string]                      Canonical task input artifact name; omitted clients retain ticket.md (choices: "ticket.md", "task.md", default: "ticket.md")
  --first-session [json]                               Optional first session created atomically with the task; Object (json formatted); Required: ["text","workingDirectory","hostId"]
  --ticket-id [string]                                 Provider ticket ID or issue input for import mode
  --ticket-url [string]                                Canonical provider ticket URL for import mode
  --ticket-description [string]                        Manual task description
  --ticket-provider [string]                           Ticket provider for this task (choices: "linear", "jira", "github")
  --github-connection-id [string]                      GitHub connection selected for this task import
  --ticket-repository-id [string]                      Stable GitHub repository ID
  --ticket-repository-full-name [string]               GitHub owner/repository display snapshot; Min length: 1
  --created-with-experiment-flags [json]               Experiment assignment and task composer used when this task was created; Object (json formatted); Required: ["task_composer"]
  --attachments [values...]                            JSON sort objects
  -h, --help                                           display help for command

```

## tasks update

```
Usage: humanlayer api tasks update [options]

Options:
  --task-id <string>                                   The task ID to update
  --name [string]                                      New name for the task; Min length: 1
  --slug [string]                                      Task slug (immutable once set); Min length: 1
  --default-working-directory [string]                 Default working directory for new sessions
  --setup-status [string]                              Setup status (choices: "pending", "in_progress", "completed", "failed")
  --setup-details [string]                             Setup error message or status info
  --ticket-id [value]                                  Provider ticket ID; null clears it
  --ticket-description [string]                        Manual task description
  --ticket-provider [value]                            Ticket provider; null clears it
  --github-connection-id [value]                       GitHub connection selected for this task
  --ticket-repository-id [value]                       Stable GitHub repository ID
  --ticket-repository-full-name [value]                GitHub owner/repository display snapshot
  --auto-advance-questions-to-research [boolean]       Auto-advance from research-questions to research
  --auto-advance-research-to-design [boolean]          Auto-advance from research to design-discussion
  --auto-advance-plan-to-worktree [boolean]            Auto-advance from plan to worktree setup
  --auto-advance-worktree-to-implementation [boolean]  Auto-advance from worktree setup to implementation
  --auto-advance-implementation-to-pr [boolean]        Auto-advance from implementation to PR description
  --slack-notifications-muted [boolean]                Mute owner-filtered Slack notifications for this task
  -h, --help                                           display help for command

```

## tasks list

```
Usage: humanlayer api tasks list [options]

Options:
  --user-id [string]  Filter by resource owner user ID
  --limit [number]    Max results to return (max 100) (default: 50)
  --offset [number]   Number of results to skip (default: 0)
  -h, --help          display help for command

```

## tasks archive

```
Usage: humanlayer api tasks archive [options]

Options:
  --task-id <string>               The task ID to archive/unarchive
  --archived [boolean]             Whether to archive (true) or unarchive
                                   (false) (default: false)
  --cascade-to-sessions [boolean]  Whether to cascade the archive status to
                                   associated sessions (default: false)
  -h, --help                       display help for command

```

## tasks create-draft

```
Usage: humanlayer api tasks create-draft [options]

Options:
  --id [string]                          Client-generated task ID for optimistic inserts
  --name [string]                        The name/title of the task (optional for drafts)
  --slug [string]                        URL-friendly slug for the task
  --default-working-directory [string]   Default working directory for sessions in this task
  --ticket-id [string]                   Provider ticket ID for import mode
  --ticket-description [string]          Manual task description
  --ticket-provider [string]             Ticket provider for this task (choices: "linear", "jira", "github")
  --github-connection-id [value]         GitHub connection selected for this draft
  --ticket-repository-id [value]         Stable GitHub repository ID
  --ticket-repository-full-name [value]  GitHub owner/repository display snapshot
  -h, --help                             display help for command

```

## sessions create

```
Usage: humanlayer api sessions create [options]

Options:
  --id [string]                                      Client-generated session ID for optimistic inserts
  --task-id [value]                                  The task to associate with this session
  --title [value]                                    The title of the session (default: null)
  --prompt <string>                                  [required] The session prompt/contents
  --working-directory <string>                       [required] The directory for the session
  --host-id [value]                                  The host_id of the online host (optional for drafts) (default: null)
  --coding-agent [string]                            The coding agent backend (choices: "claude", "opencode", "codelayer", "fold", "claude_code_terminal", default: "claude")
  --provider [string]                                The model provider (default: "anthropic")
  --model [string]                                   The model to use (default: "opus")
  --permissions-mode [string]                        The permissions mode (choices: "default", "accept_edits", "auto", "bypass", default: "default")
  --status [string]                                  The initial status of the session (choices: "draft", "ready_for_launch", default: "draft")
  --update-task-default-working-directory [boolean]  For non-owner launches: when true, overwrite the user's existing task_user_settings.working_directory with this session's workingDirectory. When false (default), preserve the prior per-user override; new rows are still seeded with this session's workingDirectory.
  -h, --help                                         display help for command

```

## sessions launch

```
Usage: humanlayer api sessions launch [options]

Options:
  --id [string]                                      Client-generated session ID for optimistic inserts (new sessions only)
  --event-id [string]                                Client-generated event ID for optimistic inserts
  --draft-id [string]                                Optional ID of an existing draft session to launch
  --task-id [value]                                  The task to associate with this session
  --text <string>                                    [required] the session contents
  --title [value]                                    The title of the session (default: null)
  --working-directory <string>                       [required] The directory to launch the session in; Min length: 1
  --repository-directory [string]                    Existing checkout path, or common source directory for a multi-repository task; Min length: 1
  --host-id <string>                                 [required] The host_id of the online host to launch the session on
  --coding-agent [string]                            The coding agent backend (choices: "claude", "opencode", "codelayer", "fold", "claude_code_terminal", default: "claude")
  --provider [string]                                The model provider (default: "anthropic")
  --model [string]                                   The model to use for the session (default: "opus")
  --effort [value]                                   The reasoning effort level (e.g. low, medium, high, xhigh, max for Claude or Codex)
  --fast-mode [value]                                Whether to enable Fast Mode (priority tier routing); type: boolean or null (default: false)
  --permissions-mode [string]                        The permissions mode for the session (choices: "default", "accept_edits", "auto", "bypass", default: "default")
  --update-task-default-working-directory [boolean]  For non-owner launches: when true, overwrite the user's existing task_user_settings.working_directory with this session's workingDirectory. When false (default), preserve the prior per-user override; new rows are still seeded with this session's workingDirectory.
  -h, --help                                         display help for command

```

## sessions update

```
Usage: humanlayer api sessions update [options]

Options:
  --session-id <string>         Format: uuid
  --title [string]
  --prompt [string]             The draft prompt/body text
  --archived [boolean]
  --permissions-mode [string]   (choices: "default", "accept_edits", "auto",
                                "bypass")
  --task-id [value]             The task to associate with this session
  --working-directory [string]  The working directory for the session
  --host-id [value]             The host_id of the online host (optional for
                                drafts)
  --coding-agent [string]       The coding agent backend (choices: "claude",
                                "opencode", "codelayer", "fold",
                                "claude_code_terminal")
  --provider [string]           The model provider
  --model [string]              The model to use for this session (e.g., opus,
                                sonnet, haiku, or full model ID)
  --effort [value]              The reasoning effort level
  --fast-mode [value]           Whether to enable Fast Mode; type: boolean or
                                null (default: false)
  -h, --help                    display help for command

```

## sessions update-status

```
Usage: humanlayer api sessions update-status [options]

Options:
  --session-id <string>  Format: uuid
  --status <string>      [required] (choices: "launching", "running",
                         "ready_for_input", "needs_approval", "failed",
                         "interrupt_requested", "interrupted", "lost")
  -h, --help             display help for command

```

## sessions continue

```
Usage: humanlayer api sessions continue [options]

Options:
  --session-id <string>        Format: uuid
  --event-id [string]          Client-generated event ID for optimistic inserts
  --text <string>              [required] Min length: 1
  --model [string]             The model to use (e.g., opus, sonnet, haiku, or
                               full model ID) (default: "opus")
  --effort [value]             The reasoning effort level
  --fast-mode [value]          Whether to enable Fast Mode; type: boolean or
                               null (default: false)
  --permissions-mode [string]  (choices: "default", "accept_edits", "auto",
                               "bypass", default: "default")
  -h, --help                   display help for command

```

## sessions fork

```
Usage: humanlayer api sessions fork [options]

Options:
  --id [string]                 Client-generated session ID for optimistic
                                insert
  --event-id [string]           Client-generated event ID for optimistic insert
  --source-session-id <string>  [required] The session to fork from
  --fork-at-event-id <string>   [required] Conversation event ID of the selected
                                user message fork point
  --text <string>               [required] Prompt for the forked session
  --title [value]               Title for the forked session (default: null)
  --archive-source [boolean]    Whether to archive the source session on fork
                                (default: false)
  -h, --help                    display help for command

```

## sessions interrupt

```
Usage: humanlayer api sessions interrupt [options]

Options:
  --session-id <string>  Format: uuid
  --message [string]
  -h, --help             display help for command

```

## sessions list

```
Usage: humanlayer api sessions list [options]

Options:
  --task-id [string]  Filter by task ID
  --user-id [string]  Filter by resource owner user ID
  --limit [number]    Max results to return (max 100) (default: 50)
  --offset [number]   Number of results to skip (default: 0)
  -h, --help          display help for command

```

## sessions v2 continue

```
Usage: humanlayer api sessions v2 continue [options]

Options:
  --session-id <string>  Format: uuid
  --message-id [string]  Client-generated id for optimistic queued_messages row
  --event-id [string]    Client-generated id for the conversation_events row
                         written on the continue/drain path
  --text <string>        [required] Min length: 1
  --intent <string>      [required] (choices: "queue", "send",
                         "interrupt_and_send")
  -h, --help             display help for command

```

## sessions v2 fork

```
Usage: humanlayer api sessions v2 fork [options]

Options:
  --input [json]  Input formatted as JSON (procedure's schema couldn't be
                  converted to CLI arguments: Invalid input type { '$schema':
                  'https://json-schema.org/draft/2020-12/schema', oneOf: [ {
                  type: 'object', properties: [Object], required: [Array] }, {
                  type: 'object', properties: [Object], required: [Array] }, {
                  type: 'object', properties: [Object], required: [Array] } ] },
                  expected object or tuple.)
  -h, --help      display help for command

```

## sessions events list

```
Usage: humanlayer api sessions events list [options]

Options:
  --session-id <string>  Session ID (required)
  --role [string]        Filter by role (choices: "user", "assistant", "system")
  --limit [number]       Max results to return (max 1000) (default: 1000)
  --offset [number]      Number of results to skip (default: 0)
  -h, --help             display help for command

```

## sessions queued-messages create

```
Usage: humanlayer api sessions queued-messages create [options]

Options:
  --session-id <string>  Format: uuid
  --message-id [string]  Format: uuid
  --text <string>        [required] Min length: 1
  -h, --help             display help for command

```

## sessions queued-messages update

```
Usage: humanlayer api sessions queued-messages update [options]

Options:
  --session-id <string>         Format: uuid
  --queued-message-id <string>  [required] Format: uuid
  --text <string>               [required] Min length: 1
  -h, --help                    display help for command

```

## sessions multiplayer-prompting update

```
Usage: humanlayer api sessions multiplayer-prompting update [options]

Options:
  --session-id <string>  Format: uuid
  --settings [value]     One of:
                         [{"type":"object","properties":{"enabled":{"type":"boolean","const":false}},"required":["enabled"]},{"type":"object","properties":{"enabled":{"type":"boolean","const":true},"addUserIds":{"minItems":1,"type":"array","items":{"type":"string","minLength":1},"optional":true},"removeUserIds":{"minItems":1,"type":"array","items":{"type":"string","minLength":1},"optional":true},"duration":{"type":"string","enum":["15m","30m","1h","2h","1d","unlimited"],"optional":true}},"required":["enabled"]}]
  -h, --help             display help for command

```

## artifacts upsert

```
Usage: humanlayer api artifacts upsert [options]

Options:
  --id [string]                Optional client-generated artifact ID (uuidv7).
                               Server uses this if provided, otherwise generates
                               one.
  --task-id <string>           The task ID to associate this artifact with
  --file-name <string>         [required] The file path/name of the artifact;
                               Min length: 1; Max length: 1024
  --content <string>           [required] The full content of the artifact; Max
                               length: 10485760
  --session-id [string]        Session ID if called from a session context
  --operation-type [string]    Type of operation that created/updated this
                               artifact (choices: "Write", "Edit", "MultiEdit",
                               "Read")
  --operation-contents [json]  Raw tool call JSON from agent SDK; Property
                               names: {"type":"string"}
  --frontmatter [json]         Parsed YAML frontmatter from the artifact
                               content; Property names: {"type":"string"}
  -h, --help                   display help for command

```

## artifacts list

```
Usage: humanlayer api artifacts list [options]

Options:
  --task-id <string>  Format: uuid
  -h, --help          display help for command

```

## artifacts get

```
Usage: humanlayer api artifacts get [options]

Options:
  --task-id <string>    Format: uuid
  --file-name <string>  [required] Min length: 1
  -h, --help            display help for command

```

## artifacts create-upload

```
Usage: humanlayer api artifacts create-upload [options]

Options:
  --task-id <string>          Format: uuid
  --file-name <string>        [required] Min length: 1; Max length: 1024
  --content-type <string>     [required] Min length: 1
  --content-hash <string>     [required] Min length: 1
  --file-size-bytes <number>  [required] Exclusive minimum: 0
  -h, --help                  display help for command

```

## artifacts update-deletion-status

```
Usage: humanlayer api artifacts update-deletion-status [options]

Options:
  --artifact-id <string>  [required] Format: uuid
  --is-deleted [boolean]  (default: false)
  -h, --help              display help for command

```

## artifacts versions list

```
Usage: humanlayer api artifacts versions list [options]

Options:
  --artifact-id <string>  [required] Format: uuid
  -h, --help              display help for command

```

## context-shards list

```
Usage: humanlayer api context-shards list [options]

Options:
  -h, --help  display help for command

```

## context-shards update-preference

```
Usage: humanlayer api context-shards update-preference [options]

Options:
  --shard-id <string>     [required] The context shard to set a personal state
                          for
  --shard-state <string>  [required] The new personal state for the current user
                          (choices: "enabled", "disabled", "dismissed")
  -h, --help              display help for command

```

## context-shards restore

```
Usage: humanlayer api context-shards restore [options]

Options:
  --shard-id <string>  [required] The user-dismissed context shard to restore
  -h, --help           display help for command

```

## comments create

```
Usage: humanlayer api comments create [options]

Options:
  --id [string]                         Client-generated comment ID for
                                        optimistic inserts
  --artifact-id <string>                [required] Format: uuid
  --content-text <string>               [required] Min length: 1
  --content-json [json]
  --commented-upon-block-text [string]
  --previous-block-text [value]         type: string or null
  --next-block-text [value]             type: string or null
  --anchor-json [json]                  Object (json formatted); Required:
                                        ["v","scope","selectedText","start","end"]
  --kind [string]                       (choices: "comment", "deletion",
                                        "approval")
  --reply-to-comment-id [string]        Format: uuid
  -h, --help                            display help for command

```

## comments update

```
Usage: humanlayer api comments update [options]

Options:
  --task-id <string>                   Format: uuid
  --artifact-filename <string>         [required]
  --truncated-comment-ids [values...]  Type: string; Min length: 8; Max length:
                                       12 Truncated comment IDs to update; Min
                                       items: 1 array (default: [])
  --resolved [boolean]                 Set resolved state
  --deleted [boolean]                  Set deleted state
  -h, --help                           display help for command

```

## comments reply

```
Usage: humanlayer api comments reply [options]

Options:
  --task-id <string>               Format: uuid
  --artifact-filename <string>     [required]
  --truncated-comment-id <string>  [required] Truncated ID of comment to reply
                                   to; Min length: 8; Max length: 12
  --content-text <string>          [required] Reply text content (markdown
                                   supported); Min length: 1
  -h, --help                       display help for command

```

## comments resolve

```
Usage: humanlayer api comments resolve [options]

Options:
  --comment-id <string>    [required] Format: uuid
  --is-resolved [boolean]  (default: false)
  -h, --help               display help for command

```

## diff-comments create

```
Usage: humanlayer api diff-comments create [options]

Options:
  --id [string]            Format: uuid
  --task-id <string>       Format: uuid
  --content-text <string>  [required]
  --content-json [value]   Any of:
                           [{"anyOf":[{"type":["string","number","boolean","null"]},{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}},{"type":"array","items":{}}]},{"type":"null"}]
                           (default: false)
  --anchor [json]          Object (json formatted); Required:
                           ["v","repoId","path","patchHash","start","end"]
  -h, --help               display help for command

```

## task-user-settings upsert

```
Usage: humanlayer api task-user-settings upsert [options]

Options:
  --task-id <string>                                   The task ID to update
  --working-directory [string]                         Per-user working directory override for this task
  --host-id [string]                                   Per-user host ID override for this task
  --auto-advance-questions-to-research [boolean]       Auto-advance from research-questions to research
  --auto-advance-research-to-design [boolean]          Auto-advance from research to design-discussion
  --auto-advance-plan-to-worktree [boolean]            Auto-advance from plan to worktree setup
  --auto-advance-worktree-to-implementation [boolean]  Auto-advance from worktree setup to implementation
  --auto-advance-implementation-to-pr [boolean]        Auto-advance from implementation to PR description
  -h, --help                                           display help for command

```

## workspace-setup retry-step

```
Usage: humanlayer api workspace-setup retry-step [options]

Options:
  --task-id <string>     Format: uuid
  --host-id <string>     [required] Min length: 1
  --local-path <string>  [required] Min length: 1
  --stage <string>       [required] (choices: "setup_requested", "preflight",
                         "worktree", "copy_globs", "setup_command", "done")
  -h, --help             display help for command

```

## workspace-setup skip-step

```
Usage: humanlayer api workspace-setup skip-step [options]

Options:
  --task-id <string>     Format: uuid
  --host-id <string>     [required] Min length: 1
  --local-path <string>  [required] Min length: 1
  --stage <string>       [required] (choices: "copy_globs", "setup_command")
  -h, --help             display help for command

```

## workspace-setup update-repository-directory

```
Usage: humanlayer api workspace-setup update-repository-directory [options]

Options:
  --task-id <string>               Format: uuid
  --host-id <string>               [required] Min length: 1
  --repository-directory <string>  [required] Min length: 1
  --expected-updated-at <string>   [required] Pattern: ^\d+$
  -h, --help                       display help for command

```

## approvals resolve

```
Usage: humanlayer api approvals resolve [options]

Options:
  --approval-id <string>             [required] Format: uuid
  --decision <string>                [required] (choices: "approve", "deny")
  --comment [string]
  --applied-suggestions [values...]  One of:
                                     [{"type":"object","properties":{"type":{"type":"string","const":"addRules"},"rules":{"type":"array","items":{"type":"object","properties":{"toolName":{"type":"string"},"ruleContent":{"type":"string","optional":true}},"required":["toolName"]}},"behavior":{"type":"string"},"destination":{"type":"string","optional":true}},"required":["type","rules","behavior"]},{"type":"object","properties":{"type":{"type":"string","const":"setMode"},"mode":{"type":"string"},"destination":{"type":"string","optional":true}},"required":["type","mode"]},{"type":"object","properties":{"type":{"type":"string","const":"addDirectories"},"directories":{"type":"array","items":{"type":"string"}},"destination":{"type":"string","optional":true}},"required":["type","directories"]}]
                                     array
  -h, --help                         display help for command

```

## sharing artifact update

```
Usage: humanlayer api sharing artifact update [options]

Options:
  --artifact-id <string>  [required] Format: uuid
  --enabled [boolean]     (default: false)
  -h, --help              display help for command

```

## projects v2 create

```
Usage: humanlayer api projects v2 create [options]

Options:
  --name <string>             [required] Min length: 1
  --description [value]       Any of:
                              [{"type":"string","minLength":1},{"type":"null"}]
  --private [boolean]         (default: false)
  --source-mode <string>      [required] (choices: "filesystem",
                              "managed_clone")
  --repositories [values...]  JSON sort objects (default: [])
  --id [string]               Format: uuid
  --host-id <string>          [required] Min length: 1
  --repository-paths [json]   Property names:
                              {"type":"string","minLength":1,"pattern":"^[a-z0-9.-]+\\/[a-zA-Z0-9._~/-]+$"}
  -h, --help                  display help for command

```

## projects v2 update

```
Usage: humanlayer api projects v2 update [options]

Options:
  --name [string]             Min length: 1
  --description [value]       Any of:
                              [{"type":"string","minLength":1},{"type":"null"}]
  --private [boolean]
  --source-mode [string]      (choices: "filesystem", "managed_clone")
  --repositories [values...]  JSON sort objects
  --project-id <string>       [required] Format: uuid
  -h, --help                  display help for command

```

## projects v2 locations

```
Usage: humanlayer api projects v2 locations [options] [command]

Available subcommands: upsert

Options:
  -h, --help        display help for command

Commands:
  upsert [options]
  help [command]    display help for command
```

## hosts alias

```
Usage: humanlayer api hosts alias [options] [command]

Available subcommands: upsert, list

Options:
  -h, --help        display help for command

Commands:
  upsert [options]
  list
  help [command]    display help for command
```

## uploads upsert-text

```
Usage: humanlayer api uploads upsert-text [options]

Options:
  --task-id <string>    The task to associate this artifact with
  --file-name <string>  [required] The file path/name of the artifact; Min
                        length: 1; Max length: 1024
  --content <string>    [required] The full text content of the artifact; Max
                        length: 10485760
  -h, --help            display help for command

```

## ai generate-title

```
Usage: humanlayer api ai generate-title [options]

Options:
  --text <string>  [required] Min length: 1
  -h, --help       display help for command

```

## automation run

```
Usage: humanlayer api automation run [options] [command]

Available subcommands: prepare

Options:
  -h, --help         display help for command

Commands:
  prepare [options]
  help [command]     display help for command
```

## durable-streams sessions

```
Usage: humanlayer api durable-streams sessions [options] [command]

Available subcommands: get-or-hydrate

Options:
  -h, --help                display help for command

Commands:
  get-or-hydrate [options]
  help [command]            display help for command
```
