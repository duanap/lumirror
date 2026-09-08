import { RateLimiter } from '../security/rate-limit.mjs'
import { SqliteScoreRepository } from '../repositories/sqlite/score-repository.mjs'
import { SqlitePublicScoreRepository } from '../repositories/sqlite/public-score-repository.mjs'
import { SqliteTaskRepository } from '../repositories/sqlite/task-repository.mjs'
import { SqlitePeriodRepository } from '../repositories/sqlite/period-repository.mjs'
import { SqliteEvaluationRepository } from '../repositories/sqlite/evaluation-repository.mjs'
import { SqliteEmployeeRepository } from '../repositories/sqlite/employee-repository.mjs'
import { SqliteOrganizationRepository } from '../repositories/sqlite/organization-repository.mjs'
import { SqliteUserRepository } from '../repositories/sqlite/user-repository.mjs'
import { SqliteAuditRepository } from '../repositories/sqlite/audit-repository.mjs'
import { SqliteSettingsRepository } from '../repositories/sqlite/settings-repository.mjs'
import { SqliteBatchRepository } from '../repositories/sqlite/batch-repository.mjs'
import { SqliteMaintenanceRepository } from '../repositories/sqlite/maintenance-repository.mjs'
import { SqliteQueryRepository } from '../repositories/sqlite/query-repository.mjs'

// One dependency graph per process. No global request queue and no hidden EdgeOne fallback.
export function createApplication(storage,configuration) {
  const scoreRepository = new SqliteScoreRepository(storage)
  const employeeRepository = new SqliteEmployeeRepository(storage)
  const userRepository = new SqliteUserRepository(storage)
  const organizationRepository = new SqliteOrganizationRepository(storage)
  const periodRepository = new SqlitePeriodRepository(storage)
  const evaluationRepository = new SqliteEvaluationRepository(storage)
  const taskRepository = new SqliteTaskRepository(storage)
  return {
    ...configuration,EVALUATION_KV:storage,STORAGE_MODEL:'sqlite-relational',RATE_LIMITER:new RateLimiter(),
    SCORE_REPOSITORY:scoreRepository,PUBLIC_SCORE_REPOSITORY:new SqlitePublicScoreRepository(storage,scoreRepository),
    TASK_REPOSITORY:taskRepository,PERIOD_REPOSITORY:periodRepository,EVALUATION_REPOSITORY:evaluationRepository,
    EMPLOYEE_REPOSITORY:employeeRepository,ORGANIZATION_REPOSITORY:organizationRepository,USER_REPOSITORY:userRepository,
    AUDIT_REPOSITORY:new SqliteAuditRepository(storage),SETTINGS_REPOSITORY:new SqliteSettingsRepository(storage),
    BATCH_REPOSITORY:new SqliteBatchRepository({storage,employeeRepository,userRepository,organizationRepository,periodRepository,evaluationRepository,taskRepository}),
    MAINTENANCE_REPOSITORY:new SqliteMaintenanceRepository(storage),
    QUERY_REPOSITORY:new SqliteQueryRepository({storage,scoreRepository,employeeRepository,periodRepository})
  }
}
