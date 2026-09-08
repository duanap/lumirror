import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { RelationalSqliteStorage as BaseStorage } from '../../../scripts/sqlite-storage.mjs'

export const SCHEMA_VERSION = 4

// Inspect an existing file read-only before WAL setup, migrations, chmod or other writes.
export function assertSupportedSchema(databaseFile) {
  if (databaseFile === ':memory:' || !existsSync(databaseFile)) return
  const database = new DatabaseSync(databaseFile,{readOnly:true})
  try {
    const version = Number(database.prepare('PRAGMA user_version').get().user_version || 0)
    const stateTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_state'").get()
    const state = stateTable ? database.prepare('SELECT schema_version,domain_version FROM app_state WHERE singleton=1').get() : null
    if (version > SCHEMA_VERSION || Number(state?.schema_version || 0) > SCHEMA_VERSION || Number(state?.domain_version || 0) > SCHEMA_VERSION) {
      throw new Error(`Database was created by a newer application; this application supports schema ${SCHEMA_VERSION}. No migration was attempted.`)
    }
  } finally { database.close() }
}

export class RelationalSqliteStorage extends BaseStorage {
  constructor(databaseFile) {
    assertSupportedSchema(databaseFile)
    super(databaseFile)
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_scores_target_evaluation ON scores(target_type,target_id,evaluation_id);
      CREATE INDEX IF NOT EXISTS idx_scores_order ON scores(list_order);
      CREATE INDEX IF NOT EXISTS idx_logs_order ON audit_logs(list_order);
      CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON users(lower(username));
      CREATE INDEX IF NOT EXISTS idx_tasks_evaluation_order ON evaluation_tasks(evaluation_id,list_order);
    `)
  }

  readiness() {
    const state = this.database.prepare('SELECT schema_version FROM app_state WHERE singleton=1').get()
    const user = this.database.prepare("SELECT 1 FROM users WHERE role='admin' AND status='active' LIMIT 1").get()
    return Boolean(state && Number(state.schema_version) === SCHEMA_VERSION && user)
  }
}
