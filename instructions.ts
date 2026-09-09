export const TASK_CONTEXT_FIRST_ACTION = "Before anything else, call the rpi_task_context tool and read its output; it hydrates the task artifact directory.";

export const START_LINKED_TICKET_ACTION = "Before phase work, if task.md or ticket.md identifies exactly one external ticket and its ticketing system is unambiguous from the ticket reference or repository configuration, move that ticket to the system's existing active or in-progress state. Do not guess a ticket, create a status or label, or fail the task when no supported ticket is configured; report the skip briefly and continue.";
