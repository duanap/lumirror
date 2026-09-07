import { DatabaseSync } from 'node:sqlite'

const DATABASE_KEY = 'employee_review_db_v1'
const SCHEMA_VERSION = 4
const COLLECTION_KEYS = [
  'users', 'departments', 'teams', 'employees', 'memberTags', 'periods', 'evaluationCodes',
  'verifyCodes', 'tasks', 'scores', 'timedInvites', 'logs'
]

const COLLECTION_TABLES = {
  users: 'users', departments: 'departments', teams: 'teams', employees: 'employees', memberTags:'member_tags',
  periods: 'review_periods', evaluationCodes: 'evaluation_activities',
  verifyCodes: 'verification_codes', tasks: 'evaluation_tasks', scores: 'scores',
  timedInvites: 'timed_invites', logs: 'audit_logs'
}

const DELETE_ORDER = [
  'score_values', 'scores', 'timed_invites', 'evaluation_tasks', 'verification_codes',
  'evaluation_rules', 'evaluation_participants', 'evaluation_targets', 'evaluation_activities',
  'users', 'employee_tags', 'employees', 'member_tags', 'teams', 'departments', 'review_periods', 'audit_logs', 'settings', 'app_state'
]

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value, fallback) => value === null || value === undefined || value === '' ? fallback : JSON.parse(value)
const textOrNull = (value) => value === null || value === undefined || value === '' ? null : String(value)
const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const snapshotTargetType = (item) => item?.targetType === 'team' || item?.targetTeamId ? 'team' : 'employee'
const snapshotTargetId = (item) => String(item?.targetId || (snapshotTargetType(item) === 'team' ? item?.targetTeamId : item?.targetEmployeeId) || '')
const withTargetReference = (item,targetType,targetId) => {
  const output = {...item,targetType,targetId}
  if (targetType === 'team') {
    output.targetTeamId = targetId
    delete output.targetEmployeeId
  } else {
    output.targetEmployeeId = targetId
    delete output.targetTeamId
  }
  return output
}

function without(item, keys) {
  const output = { ...item }
  for (const key of keys) delete output[key]
  return output
}

function rowsByParent(rows, parentKey, valueKey = null) {
  const grouped = new Map()
  for (const row of rows) {
    const items = grouped.get(row[parentKey]) || []
    items.push(valueKey ? row[valueKey] : parseJson(row.payload_json, {}))
    grouped.set(row[parentKey], items)
  }
  return grouped
}

export class RelationalSqliteStorage {
  constructor(databaseFile) {
    this.database = new DatabaseSync(databaseFile)
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;')
    const legacyKv = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv_store'").get()
    const relationalState = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_state'").get()
    if (legacyKv && !relationalState) {
      this.database.close()
      throw new Error('Legacy KV SQLite database detected; automatic data migration is disabled')
    }
    this.createSchema()
  }

  getSchemaVersion() {
    return Number(this.database.prepare('PRAGMA user_version').get().user_version || 0)
  }

  get snapshotReadCount() {
    return this._snapshotReadCount || 0
  }

  createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), schema_version INTEGER NOT NULL,
        domain_version INTEGER NOT NULL, created_at TEXT, updated_at TEXT, extra_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), system_name TEXT NOT NULL,
        public_session_minutes INTEGER NOT NULL CHECK (public_session_minutes BETWEEN 5 AND 240),
        log_retention_days INTEGER NOT NULL CHECK (log_retention_days BETWEEN 7 AND 3650)
      );
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, sort_value INTEGER,
        payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY, department_id TEXT NOT NULL REFERENCES departments(id), name TEXT NOT NULL,
        status TEXT NOT NULL, sort_value INTEGER, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY, department_id TEXT NOT NULL REFERENCES departments(id),
        team_id TEXT NOT NULL REFERENCES teams(id), name TEXT NOT NULL, status TEXT NOT NULL,
        payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL, status TEXT NOT NULL,
        department_id TEXT REFERENCES departments(id), team_id TEXT REFERENCES teams(id),
        employee_id TEXT REFERENCES employees(id), payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_periods (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, start_time TEXT NOT NULL,
        end_time TEXT NOT NULL, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluation_activities (
        id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, link_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        period_id TEXT NOT NULL REFERENCES review_periods(id),
        department_id TEXT NOT NULL REFERENCES departments(id), team_id TEXT NOT NULL REFERENCES teams(id),
        status TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
        payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluation_rules (
        evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL, name TEXT NOT NULL, min_value REAL NOT NULL, max_value REAL NOT NULL,
        weight REAL NOT NULL, operation TEXT NOT NULL DEFAULT 'add' CHECK (operation IN ('add', 'subtract')),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        payload_json TEXT NOT NULL, list_order INTEGER NOT NULL, PRIMARY KEY (evaluation_id, rule_id)
      );
      CREATE TABLE IF NOT EXISTS evaluation_participants (
        evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id), list_order INTEGER NOT NULL,
        PRIMARY KEY (evaluation_id, employee_id)
      );
      CREATE TABLE IF NOT EXISTS evaluation_targets (
        evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('employee', 'team')),
        target_id TEXT NOT NULL, list_order INTEGER NOT NULL,
        PRIMARY KEY (evaluation_id, target_type, target_id)
      );
      CREATE TABLE IF NOT EXISTS verification_codes (
        id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
        participant_employee_id TEXT REFERENCES employees(id), code_hash TEXT NOT NULL,
        code_fingerprint TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
        list_order INTEGER NOT NULL, UNIQUE (evaluation_id, code_hash)
      );
      CREATE TABLE IF NOT EXISTS evaluation_tasks (
        id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
        verification_code_id TEXT NOT NULL REFERENCES verification_codes(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('employee', 'team')),
        target_id TEXT NOT NULL, status TEXT NOT NULL,
        payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scores (
        id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL UNIQUE REFERENCES evaluation_tasks(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('employee', 'team')),
        target_id TEXT NOT NULL, total REAL NOT NULL,
        created_at TEXT NOT NULL, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS score_values (
        score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE, rule_id TEXT NOT NULL,
        value REAL NOT NULL, list_order INTEGER NOT NULL, PRIMARY KEY (score_id, rule_id)
      );
      CREATE TABLE IF NOT EXISTS timed_invites (
        id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
        verification_code_id TEXT NOT NULL REFERENCES verification_codes(id) ON DELETE CASCADE,
        link_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL, expires_at TEXT,
        payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_id TEXT, role TEXT, created_at TEXT NOT NULL,
        detail_json TEXT NOT NULL, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_teams_department ON teams(department_id);
      CREATE INDEX IF NOT EXISTS idx_employees_team ON employees(team_id);
      CREATE INDEX IF NOT EXISTS idx_evaluations_team ON evaluation_activities(team_id);
      CREATE INDEX IF NOT EXISTS idx_verification_evaluation ON verification_codes(evaluation_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_verification_status ON evaluation_tasks(verification_code_id, status);
      CREATE INDEX IF NOT EXISTS idx_logs_created ON audit_logs(created_at);
    `)
    this.migrateTargetSchema()
    this.migrateMemberTagSchema()
    const ruleColumns = new Set(this.database.prepare('PRAGMA table_info(evaluation_rules)').all().map((column) => column.name))
    if (!ruleColumns.has('operation')) this.database.exec("ALTER TABLE evaluation_rules ADD COLUMN operation TEXT NOT NULL DEFAULT 'add' CHECK (operation IN ('add', 'subtract'))")
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_verification_status ON evaluation_tasks(verification_code_id, status);
      CREATE INDEX IF NOT EXISTS idx_scores_evaluation_target ON scores(evaluation_id, target_type, target_id);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
    this.database.prepare('UPDATE app_state SET schema_version = ? WHERE singleton = 1 AND schema_version < ?').run(SCHEMA_VERSION,SCHEMA_VERSION)
  }

  migrateTargetSchema() {
    const columns = new Set(this.database.prepare('PRAGMA table_info(evaluation_targets)').all().map((column) => column.name))
    if (columns.has('target_type')) return
    this.database.exec('PRAGMA foreign_keys = OFF')
    try {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE evaluation_targets_v3 (
          evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
          target_type TEXT NOT NULL CHECK (target_type IN ('employee', 'team')),
          target_id TEXT NOT NULL, list_order INTEGER NOT NULL,
          PRIMARY KEY (evaluation_id, target_type, target_id)
        );
        INSERT INTO evaluation_targets_v3 (evaluation_id, target_type, target_id, list_order)
          SELECT evaluation_id, 'employee', employee_id, list_order FROM evaluation_targets;
        CREATE TABLE evaluation_tasks_v3 (
          id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
          verification_code_id TEXT NOT NULL REFERENCES verification_codes(id) ON DELETE CASCADE,
          target_type TEXT NOT NULL CHECK (target_type IN ('employee', 'team')),
          target_id TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
        );
        INSERT INTO evaluation_tasks_v3 (id, evaluation_id, verification_code_id, target_type, target_id, status, payload_json, list_order)
          SELECT id, evaluation_id, verification_code_id, 'employee', target_employee_id, status, payload_json, list_order FROM evaluation_tasks;
        CREATE TABLE scores_v3 (
          id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL UNIQUE REFERENCES evaluation_tasks_v3(id) ON DELETE CASCADE,
          target_type TEXT NOT NULL CHECK (target_type IN ('employee', 'team')),
          target_id TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL,
          payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
        );
        INSERT INTO scores_v3 (id, evaluation_id, task_id, target_type, target_id, total, created_at, payload_json, list_order)
          SELECT id, evaluation_id, task_id, 'employee', target_employee_id, total, created_at, payload_json, list_order FROM scores;
        CREATE TABLE score_values_v3 (
          score_id TEXT NOT NULL REFERENCES scores_v3(id) ON DELETE CASCADE, rule_id TEXT NOT NULL,
          value REAL NOT NULL, list_order INTEGER NOT NULL, PRIMARY KEY (score_id, rule_id)
        );
        INSERT INTO score_values_v3 (score_id, rule_id, value, list_order)
          SELECT score_id, rule_id, value, list_order FROM score_values;
        DROP TABLE score_values;
        DROP TABLE scores;
        DROP TABLE evaluation_tasks;
        DROP TABLE evaluation_targets;
        ALTER TABLE evaluation_targets_v3 RENAME TO evaluation_targets;
        ALTER TABLE evaluation_tasks_v3 RENAME TO evaluation_tasks;
        ALTER TABLE scores_v3 RENAME TO scores;
        ALTER TABLE score_values_v3 RENAME TO score_values;
        COMMIT;
      `)
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    } finally {
      this.database.exec('PRAGMA foreign_keys = ON')
    }
  }

  migrateMemberTagSchema() {
    const hasTags = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'member_tags'").get()
    const hasLinks = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'employee_tags'").get()
    if (hasTags && hasLinks) return
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS member_tags (
          id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS employee_tags (
          employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES member_tags(id) ON DELETE CASCADE,
          list_order INTEGER NOT NULL, PRIMARY KEY (employee_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_employee_tags_tag ON employee_tags(tag_id);
        COMMIT;
      `)
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    }
  }

  async get(key, options = {}) {
    if (key !== DATABASE_KEY) return null
    this._snapshotReadCount = (this._snapshotReadCount || 0) + 1
    const state = this.database.prepare('SELECT * FROM app_state WHERE singleton = 1').get()
    if (!state) return null
    if (Number(state.schema_version) !== SCHEMA_VERSION) throw new Error(`Unsupported relational schema version: ${state.schema_version}`)
    const collections = {}
    for (const [collection, table] of Object.entries(COLLECTION_TABLES)) {
      collections[collection] = this.database.prepare(`SELECT payload_json FROM ${table} ORDER BY list_order`).all().map((row) => parseJson(row.payload_json, {}))
    }
    collections.tasks = this.database.prepare('SELECT target_type, target_id, payload_json FROM evaluation_tasks ORDER BY list_order').all()
      .map((row) => withTargetReference(parseJson(row.payload_json,{}),row.target_type,row.target_id))
    collections.scores = this.database.prepare('SELECT target_type, target_id, payload_json FROM scores ORDER BY list_order').all()
      .map((row) => withTargetReference(parseJson(row.payload_json,{}),row.target_type,row.target_id))
    const employeeTags = rowsByParent(this.database.prepare('SELECT employee_id, tag_id FROM employee_tags ORDER BY employee_id, list_order').all(),'employee_id','tag_id')
    collections.employees = collections.employees.map((item) => ({...item,tagIds:employeeTags.get(item.id) || []}))

    const rules = new Map()
    for (const row of this.database.prepare('SELECT evaluation_id, operation, payload_json FROM evaluation_rules ORDER BY evaluation_id, list_order').all()) {
      const items = rules.get(row.evaluation_id) || []
      items.push({...parseJson(row.payload_json,{}),operation:row.operation === 'subtract' ? 'subtract' : 'add'})
      rules.set(row.evaluation_id,items)
    }
    const participants = rowsByParent(this.database.prepare('SELECT evaluation_id, employee_id FROM evaluation_participants ORDER BY evaluation_id, list_order').all(), 'evaluation_id', 'employee_id')
    const employeeTargets = rowsByParent(this.database.prepare("SELECT evaluation_id, target_id FROM evaluation_targets WHERE target_type = 'employee' ORDER BY evaluation_id, list_order").all(), 'evaluation_id', 'target_id')
    const teamTargets = rowsByParent(this.database.prepare("SELECT evaluation_id, target_id FROM evaluation_targets WHERE target_type = 'team' ORDER BY evaluation_id, list_order").all(), 'evaluation_id', 'target_id')
    collections.evaluationCodes = collections.evaluationCodes.map((item) => ({
      ...item, rules:rules.get(item.id) || [],
      participantEmployeeIds:participants.get(item.id) || [],
      targetEmployeeIds:employeeTargets.get(item.id) || [],targetTeamIds:teamTargets.get(item.id) || []
    }))

    const values = new Map()
    for (const row of this.database.prepare('SELECT score_id, rule_id, value FROM score_values ORDER BY score_id, list_order').all()) {
      const item = values.get(row.score_id) || {}
      item[row.rule_id] = row.value
      values.set(row.score_id, item)
    }
    collections.scores = collections.scores.map((item) => ({ ...item, values:values.get(item.id) || {} }))
    const settings = this.database.prepare('SELECT * FROM settings WHERE singleton = 1').get()
    const database = {
      ...parseJson(state.extra_json, {}), version:Number(state.domain_version),
      createdAt:state.created_at, updatedAt:state.updated_at, ...collections,
      settings:{
        systemName:settings.system_name, publicSessionMinutes:Number(settings.public_session_minutes),
        logRetentionDays:Number(settings.log_retention_days)
      }
    }
    return options.type === 'json' ? database : json(database)
  }

  async put(key, value) {
    if (key !== DATABASE_KEY) throw new Error(`Unsupported storage key: ${key}`)
    const database = typeof value === 'string' ? JSON.parse(value) : value
    if (!database || typeof database !== 'object' || Array.isArray(database)) throw new Error('Database snapshot must be an object')
    const extra = { ...database }
    for (const collection of COLLECTION_KEYS) delete extra[collection]
    for (const keyName of ['settings','version','createdAt','updatedAt']) delete extra[keyName]

    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const table of DELETE_ORDER) this.database.exec(`DELETE FROM ${table}`)
      this.database.prepare('INSERT INTO app_state (singleton, schema_version, domain_version, created_at, updated_at, extra_json) VALUES (1, ?, ?, ?, ?, ?)')
        .run(SCHEMA_VERSION, Number(database.version || 1), textOrNull(database.createdAt), textOrNull(database.updatedAt), json(extra))
      const settings = database.settings || {}
      this.database.prepare('INSERT INTO settings (singleton, system_name, public_session_minutes, log_retention_days) VALUES (1, ?, ?, ?)')
        .run(String(settings.systemName || '和光镜鉴'), Number(settings.publicSessionMinutes || 120), Number(settings.logRetentionDays || 90))

      const insertDepartment = this.database.prepare('INSERT INTO departments (id, name, status, sort_value, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.departments || []).entries()) insertDepartment.run(item.id,item.name,item.status || 'active',numberOrNull(item.sort),json(item),index)
      const insertTeam = this.database.prepare('INSERT INTO teams (id, department_id, name, status, sort_value, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.teams || []).entries()) insertTeam.run(item.id,item.departmentId,item.name,item.status || 'active',numberOrNull(item.sort),json(item),index)
      const insertMemberTag = this.database.prepare('INSERT INTO member_tags (id, name, payload_json, list_order) VALUES (?, ?, ?, ?)')
      for (const [index,item] of (database.memberTags || []).entries()) insertMemberTag.run(item.id,item.name,json(item),index)
      const insertEmployee = this.database.prepare('INSERT INTO employees (id, department_id, team_id, name, status, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insertEmployeeTag = this.database.prepare('INSERT INTO employee_tags (employee_id, tag_id, list_order) VALUES (?, ?, ?)')
      for (const [index,item] of (database.employees || []).entries()) {
        insertEmployee.run(item.id,item.departmentId,item.teamId,item.name,item.status || 'active',json(without(item,['tagIds','tags'])),index)
        for (const [tagIndex,tagId] of (item.tagIds || []).entries()) insertEmployeeTag.run(item.id,tagId,tagIndex)
      }
      const insertUser = this.database.prepare('INSERT INTO users (id, username, role, status, department_id, team_id, employee_id, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.users || []).entries()) insertUser.run(item.id,item.username,item.role || 'admin',item.status || 'active',textOrNull(item.departmentId),textOrNull(item.teamId),textOrNull(item.employeeId),json(item),index)
      const insertPeriod = this.database.prepare('INSERT INTO review_periods (id, name, status, start_time, end_time, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.periods || []).entries()) insertPeriod.run(item.id,item.name,item.status || 'active',item.startTime,item.endTime,json(item),index)

      const insertEvaluation = this.database.prepare('INSERT INTO evaluation_activities (id, code, link_code, name, period_id, department_id, team_id, status, start_time, end_time, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const insertRule = this.database.prepare('INSERT INTO evaluation_rules (evaluation_id, rule_id, name, min_value, max_value, weight, operation, enabled, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const insertParticipant = this.database.prepare('INSERT INTO evaluation_participants (evaluation_id, employee_id, list_order) VALUES (?, ?, ?)')
      const insertTarget = this.database.prepare('INSERT INTO evaluation_targets (evaluation_id, target_type, target_id, list_order) VALUES (?, ?, ?, ?)')
      for (const [index,item] of (database.evaluationCodes || []).entries()) {
        insertEvaluation.run(item.id,item.code,item.linkCode,item.name,item.periodId,item.departmentId,item.teamId,item.status || 'active',item.startTime,item.endTime,json(without(item,['rules','participantEmployeeIds','targetEmployeeIds','targetTeamIds'])),index)
        for (const [ruleIndex,rule] of (item.rules || []).entries()) insertRule.run(item.id,rule.id,rule.name,Number(rule.min),Number(rule.max),Number(rule.weight ?? 100),rule.operation === 'subtract' ? 'subtract' : 'add',rule.enabled ? 1 : 0,json({...rule,operation:rule.operation === 'subtract' ? 'subtract' : 'add'}),ruleIndex)
        for (const [participantIndex,employeeId] of (item.participantEmployeeIds || []).entries()) insertParticipant.run(item.id,employeeId,participantIndex)
        for (const [targetIndex,employeeId] of (item.targetEmployeeIds || []).entries()) insertTarget.run(item.id,'employee',employeeId,targetIndex)
        for (const [targetIndex,teamId] of (item.targetTeamIds || []).entries()) insertTarget.run(item.id,'team',teamId,targetIndex)
      }

      const insertVerify = this.database.prepare('INSERT INTO verification_codes (id, evaluation_id, participant_employee_id, code_hash, code_fingerprint, status, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.verifyCodes || []).entries()) insertVerify.run(item.id,item.evaluationCodeId,textOrNull(item.participantEmployeeId),item.codeHash,item.codeFingerprint,item.status || 'unused',json(item),index)
      const insertTask = this.database.prepare('INSERT INTO evaluation_tasks (id, evaluation_id, verification_code_id, target_type, target_id, status, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.tasks || []).entries()) insertTask.run(item.id,item.evaluationCodeId,item.verifyCodeId,snapshotTargetType(item),snapshotTargetId(item),item.status || 'pending',json(item),index)

      const insertScore = this.database.prepare('INSERT INTO scores (id, evaluation_id, task_id, target_type, target_id, total, created_at, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const insertScoreValue = this.database.prepare('INSERT INTO score_values (score_id, rule_id, value, list_order) VALUES (?, ?, ?, ?)')
      for (const [index,item] of (database.scores || []).entries()) {
        insertScore.run(item.id,item.evaluationCodeId,item.taskId,snapshotTargetType(item),snapshotTargetId(item),Number(item.total),item.createdAt,json(without(item,['values'])),index)
        for (const [valueIndex,[ruleId,scoreValue]] of Object.entries(item.values || {}).entries()) insertScoreValue.run(item.id,ruleId,Number(scoreValue),valueIndex)
      }

      const insertInvite = this.database.prepare('INSERT INTO timed_invites (id, evaluation_id, verification_code_id, link_code, status, expires_at, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.timedInvites || []).entries()) insertInvite.run(item.id,item.evaluationCodeId,item.verifyCodeId,item.linkCode,item.status || 'unused',textOrNull(item.expiresAt),json(item),index)
      const insertLog = this.database.prepare('INSERT INTO audit_logs (id, action, actor_id, role, created_at, detail_json, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const [index,item] of (database.logs || []).entries()) insertLog.run(item.id,item.action,textOrNull(item.actorId),textOrNull(item.role),item.createdAt,json(item.detail || {}),json(item),index)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.database.close()
  }
}
