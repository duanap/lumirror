import { spawn } from 'node:child_process'
import { repositoryContracts } from '../server/repositories/contracts/index.mjs'

const scripts = ['scripts/api-smoke.mjs', 'scripts/server-smoke.mjs']
const expectedRepositories = ['UserRepository', 'OrganizationRepository', 'EvaluationRepository', 'TaskRepository', 'ScoreRepository', 'InviteRepository', 'AuditRepository']

for (const name of expectedRepositories) {
  if (!repositoryContracts[name]?.length) throw new Error(`Missing R2 repository contract: ${name}`)
}

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${script} failed with ${signal || `exit code ${code}`}`))
    })
  })
}

for (const script of scripts) await run(script)
console.log('R2 golden behavior contract passed: score, scope, team evaluation, archive, timed invite, trend, permissions and migration')
