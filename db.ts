import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";

type Database = BetterSqlite3.Database;

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    draft_prompt TEXT NOT NULL DEFAULT '',
    workflow_type TEXT NOT NULL DEFAULT 'rpi',
    worktree_timing TEXT NOT NULL DEFAULT 'later',
    is_draft INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    host_id TEXT,
    default_directory TEXT,
    provider_id TEXT,
    model TEXT,
    reasoning_level TEXT,
    service_tier TEXT,
    permission_mode TEXT,
    auto_advance INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE sessions (
    thread_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    label TEXT,
    skill_id TEXT,
    launched_by TEXT NOT NULL,
    forked_from_thread_id TEXT,
    hl_status TEXT NOT NULL DEFAULT 'draft',
    hl_status_at INTEGER NOT NULL,
    had_turn INTEGER NOT NULL DEFAULT 0,
    interrupted INTEGER NOT NULL DEFAULT 0,
    next_step_json TEXT,
    summary_json TEXT,
    advanced_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    file_name TEXT NOT NULL,
    frontmatter_json TEXT NOT NULL DEFAULT '{}',
    content_type TEXT NOT NULL DEFAULT 'text/markdown',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    current_version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(task_id, file_name)
  )
  `,
  `
  CREATE TABLE artifact_versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version INTEGER NOT NULL,
    content BLOB NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    operation TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(artifact_id, version)
  )
  `,
  `
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version_id TEXT NOT NULL,
    reply_to_id TEXT,
    content_text TEXT NOT NULL,
    block_text TEXT,
    prev_block_text TEXT,
    next_block_text TEXT,
    anchor_json TEXT,
    kind TEXT NOT NULL DEFAULT 'comment',
    is_resolved INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_by_agent INTEGER NOT NULL DEFAULT 0,
    created_by_thread_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE notified (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE scratch_pads (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id),
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE task_ui_state (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id),
    json TEXT NOT NULL
  )
  `,
  `
  ALTER TABLE sessions ADD COLUMN hydrated_at INTEGER
  `,
  `
  CREATE TABLE launch_attempts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    from_thread_id TEXT NOT NULL,
    skill_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'spawned', 'uncertain', 'failed')),
    thread_id TEXT,
    created_at INTEGER NOT NULL
  )
  `,
  `ALTER TABLE tasks ADD COLUMN base_environment_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN worktree_environment_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN aa_questions_to_research INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE tasks ADD COLUMN aa_research_to_design INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE tasks ADD COLUMN aa_plan_to_worktree INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE tasks ADD COLUMN aa_worktree_to_implementation INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE tasks ADD COLUMN aa_implementation_to_pr INTEGER NOT NULL DEFAULT 0`,
  `
  CREATE TABLE launch_attempts_v2 (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    from_thread_id TEXT,
    skill_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'spawned', 'uncertain', 'failed')),
    thread_id TEXT,
    created_at INTEGER NOT NULL
  )
  `,
  `
  INSERT INTO launch_attempts_v2 (id, task_id, from_thread_id, skill_id, status, thread_id, created_at)
  SELECT id, task_id, from_thread_id, skill_id, status, thread_id, created_at
  FROM launch_attempts
  `,
  `DROP TABLE launch_attempts`,
  `ALTER TABLE launch_attempts_v2 RENAME TO launch_attempts`,
  `ALTER TABLE sessions ADD COLUMN blocked_reason TEXT`,
  `ALTER TABLE sessions ADD COLUMN last_reconcile_seq INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE sessions ADD COLUMN last_summarized_turn_key TEXT`,
  `ALTER TABLE sessions ADD COLUMN completed_turn_key TEXT`,
  `
  CREATE TABLE mirror_state (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    file_name TEXT NOT NULL,
    last_written_sha TEXT,
    last_seen_sha TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (task_id, file_name)
  )
  `,
  `
  CREATE TABLE send_receipts (
    request_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    thread_id TEXT NOT NULL,
    comment_ids_json TEXT NOT NULL,
    mode TEXT NOT NULL,
    sent_ids_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
  `,
  `ALTER TABLE send_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'done'`,
  `ALTER TABLE send_receipts ADD COLUMN delivered_chunk_indexes_json TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE send_receipts ADD COLUMN completed_at INTEGER`,
  `
  CREATE TABLE notification_suppressions (
    thread_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
  `,
  `ALTER TABLE sessions ADD COLUMN next_step_turn_key TEXT`,
  `ALTER TABLE launch_attempts ADD COLUMN command_line TEXT`,
  `ALTER TABLE launch_attempts ADD COLUMN label TEXT`,
  `ALTER TABLE launch_attempts ADD COLUMN environment_role TEXT NOT NULL DEFAULT 'base' CHECK(environment_role IN ('base', 'worktree'))`,
  `ALTER TABLE launch_attempts ADD COLUMN launched_by TEXT NOT NULL DEFAULT 'user'`,
  `
  CREATE TABLE notification_suppressions_v2 (
    thread_id TEXT NOT NULL,
    completed_turn_key TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    consumed_at INTEGER,
    PRIMARY KEY (thread_id, completed_turn_key)
  )
  `,
  `
  INSERT OR IGNORE INTO notification_suppressions_v2 (thread_id, completed_turn_key, reason, created_at, consumed_at)
  SELECT thread_id, '', reason, created_at, NULL
  FROM notification_suppressions
  `,
  `DROP TABLE notification_suppressions`,
  `ALTER TABLE notification_suppressions_v2 RENAME TO notification_suppressions`,
];

export function openPluginDatabase(bb: BbPluginApi): Database {
  const db = bb.storage.database();
  db.pragma("foreign_keys = ON");
  bb.storage.migrate(db, MIGRATIONS);
  return db;
}

export function nowMs() {
  return Date.now();
}

export function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (input === null || input === undefined || input === "") return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

export function readRows<T>(db: Database, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function readRow<T>(db: Database, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function writeRow(db: Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...params);
}

export function transaction<TArgs extends unknown[], TResult>(
  db: Database,
  fn: (...args: TArgs) => TResult,
) {
  return db.transaction(fn);
}

export function consumeSuppression(db: Database, threadId: string, turnKey: string) {
  const timestamp = nowMs();
  const result = writeRow(
    db,
    `
    UPDATE notification_suppressions
    SET consumed_at = ?
    WHERE thread_id = ? AND completed_turn_key = ? AND consumed_at IS NULL
    `,
    timestamp,
    threadId,
    turnKey,
  );
  return result.changes === 1;
}
