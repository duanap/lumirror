import { parentPort, workerData } from 'node:worker_threads'
import { RelationalSqliteStorage } from './sqlite-storage.mjs'
import { SqliteScoreRepository } from '../server/repositories/sqlite/score-repository.mjs'

const storage = new RelationalSqliteStorage(workerData.databaseFile)
try {
  const repository = new SqliteScoreRepository(storage)
  repository.submitAtomic(JSON.parse(workerData.input))
  parentPort.postMessage({ok:true})
} catch (error) {
  parentPort.postMessage({ok:false,status:error?.status || 500,code:error?.code || 'UNKNOWN'})
} finally {
  storage.close()
}
