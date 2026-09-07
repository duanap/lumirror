const contract = (...operations) => Object.freeze(operations)

export const repositoryContracts = Object.freeze({
  UserRepository: contract('findById', 'findByUsername', 'create', 'update'),
  OrganizationRepository: contract('listDepartments', 'listTeams', 'listEmployees', 'create', 'update'),
  EvaluationRepository: contract('findById', 'listVisible', 'create', 'update'),
  PeriodRepository: contract('list', 'create', 'update', 'delete'),
  TaskRepository: contract('findNextPending', 'listByEvaluation', 'markSubmitted'),
  ScoreRepository: contract('create', 'listByTarget', 'aggregateTrend'),
  InviteRepository: contract('create', 'findByCode', 'updateProgress'),
  AuditRepository: contract('append', 'list')
})

export function assertRepositoryContract(name, repository) {
  const operations = repositoryContracts[name]
  if (!operations) throw new Error(`Unknown repository contract: ${name}`)
  for (const operation of operations) {
    if (typeof repository?.[operation] !== 'function') throw new Error(`${name}.${operation} is required`)
  }
  return repository
}
