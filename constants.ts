// Single source of truth for the task artifact root directory name, relative to a workspace
// root. Every path builder that needs `.rpi/tasks/<slug>/...` imports this constant instead of
// hardcoding the literal, so renaming the directory again only touches this file.
export const TASK_ROOT_DIR = ".rpi";
