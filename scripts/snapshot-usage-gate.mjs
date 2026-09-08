import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname,'..')
const edgePath = path.join(root,'edge-functions/api/[[default]].js')
const productionPath = path.join(root,'scripts/production-server.mjs')
const nodeDirectPath = path.join(root,'server/node-direct-routes.mjs')
const adminRoutesPath = path.join(root,'server/http/admin-routes.mjs')
const publicRoutesPath = path.join(root,'server/http/public-routes.mjs')
const maintenancePath = path.join(root,'server/repositories/sqlite/maintenance-repository.mjs')
const serverDir = path.join(root,'server')

const [edgeSource,productionSource,nodeDirectSource,adminRoutesSource,publicRoutesSource,maintenanceSource] = await Promise.all([
  readFile(edgePath,'utf8'),readFile(productionPath,'utf8'),readFile(nodeDirectPath,'utf8'),
  readFile(adminRoutesPath,'utf8'),readFile(publicRoutesPath,'utf8'),readFile(maintenancePath,'utf8')
])

const edgeLines = edgeSource.split('\n')
const publicRouteLine = edgeLines.findIndex((line) => line.includes('async function publicRoutes(')) + 1
const onRequestLine = edgeLines.findIndex((line) => line.includes('export default async function onRequest(')) + 1
const legacyCalls = []
const outsideLegacyCalls = []
for (let index = 0; index < edgeLines.length; index += 1) {
  if (!/await saveDatabase\(context,db\)/.test(edgeLines[index])) continue
  const call = {source:'edge-functions/api/[[default]].js',line:index + 1,text:edgeLines[index].trim()}
  if (publicRouteLine > 0 && onRequestLine > publicRouteLine && call.line > publicRouteLine && call.line < onRequestLine) legacyCalls.push({...call,kind:'legacy-edgeone-fallback'})
  else outsideLegacyCalls.push({...call,kind:'unexpected-edge-snapshot-mutation'})
}

async function collectMjs(dir) {
  const files = []
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const full = path.join(dir,entry.name)
    if (entry.isDirectory()) files.push(...await collectMjs(full))
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(full)
  }
  return files
}

const disallowedNodeMutations = []
for (const file of [productionPath,...await collectMjs(serverDir)]) {
  const source = await readFile(file,'utf8')
  const relative = path.relative(root,file).replaceAll('\\','/')
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/\bsaveDatabase\s*\(/.test(line)) disallowedNodeMutations.push({source:relative,line:index+1,text:line.trim(),kind:'node-saveDatabase'})
    if (/\.put\s*\(\s*DATABASE_KEY/.test(line) && file !== maintenancePath) disallowedNodeMutations.push({source:relative,line:index+1,text:line.trim(),kind:'node-snapshot-put'})
  }
}

const maintenanceBulkWrites = maintenanceSource.split('\n').flatMap((line,index) => /this\.storage\.put\(DATABASE_KEY,snapshot\)/.test(line)
  ? [{source:'server/repositories/sqlite/maintenance-repository.mjs',line:index+1,text:line.trim(),kind:'maintenance-bulk-transaction'}]
  : [])

const contractFailures = []
const requireMarker = (source,marker,scope) => {
  if (!source.includes(marker)) contractFailures.push({kind:'missing-direct-contract',scope,marker})
}

// Production HTTP must dispatch directly into the native Node route table. The route
// handlers use repositories for normal reads/writes; whole-database writes stay in maintenance only.
requireMarker(productionSource,'const handleRequest = createRequestHandler(env)','production-server')
requireMarker(productionSource,'http.createServer((req, res) => { void handleRequest(req, res) })','production-server')
requireMarker(nodeDirectSource,'export const NODE_ROUTES = [...adminRoutes,...publicRoutes]','node-route-dispatch')
requireMarker(nodeDirectSource,'return runWithAuditActor(ctx.actor,() => route.handler(ctx))','node-route-dispatch')
requireMarker(publicRoutesSource,"{method:'POST',path:'/public/submit-score'",'public-native-routes')
for (const marker of [
  "route('POST','/admin/batch'",
  "route('POST','/admin/maintenance/cleanup'",
  "route('GET','/admin/export/json'",
  "route('POST','/admin/export/full-json'",
  "route('POST','/admin/import/preflight'",
  "route('POST','/admin/import/json'"
]) requireMarker(adminRoutesSource,marker,'admin-native-routes')

// The retained EdgeOne compatibility runtime must still route repository-backed domains
// before its legacy whole-snapshot fallback boundary.
const directCore = onRequestLine > 0 ? edgeLines.slice(onRequestLine - 1).join('\n') : ''
for (const marker of [
  "path === '/public/evaluation-title'",
  "path === '/public/verify-entry'",
  "path === '/admin/login'",
  "path === '/admin/change-password'",
  "path === '/admin/users' || path.startsWith('/admin/users/')",
  "path === '/admin/settings' || path === '/admin/settings/score-rules'",
  "path === '/admin/employees' || path.startsWith('/admin/employees/')",
  "path === '/admin/member-tags' || path.startsWith('/admin/member-tags/')",
  "getOrganizationRepository(context)",
  "getEvaluationRepository(context)",
  "getPeriodRepository(context)",
  "path === '/public/timed-entry'",
  "path === '/public/current-task'",
  "path === '/public/remaining'",
  "getScoreRepository(context)?.listResults",
  "getTaskRepository(context)?.generateVerifyCodes",
  "getTaskRepository(context)?.generateTimedInvite",
  "getTaskRepository(context)?.generateTasks",
  "getTaskRepository(context)?.deleteVerifyCode",
  "getTaskRepository(context)?.deleteTask"
]) requireMarker(directCore,marker,'edge-compatibility-direct-core')
requireMarker(directCore,'const db = await loadDatabase(context)','edge-compatibility-fallback-boundary')

const EXPECTED_LEGACY_EDGE_SAVE_CALLS = 37
if (legacyCalls.length !== EXPECTED_LEGACY_EDGE_SAVE_CALLS) contractFailures.push({
  kind:'legacy-fallback-save-count-changed',expected:EXPECTED_LEGACY_EDGE_SAVE_CALLS,actual:legacyCalls.length
})
if (maintenanceBulkWrites.length !== 1) contractFailures.push({
  kind:'maintenance-bulk-write-count-invalid',expected:1,actual:maintenanceBulkWrites.length
})

const normalCandidates = [...outsideLegacyCalls,...disallowedNodeMutations,...contractFailures]
const report = {
  edgeSource:path.relative(root,edgePath).replaceAll('\\','/'),
  productionDispatch:'native-node-route-table',
  legacyEdgeOneFallbackCalls:legacyCalls.length,
  expectedLegacyEdgeOneFallbackCalls:EXPECTED_LEGACY_EDGE_SAVE_CALLS,
  maintenanceSnapshotReads:'allowed',
  maintenanceBulkSnapshotWrites:maintenanceBulkWrites.length,
  normalSnapshotMutationCandidates:normalCandidates.length,
  legacyCalls,
  maintenanceBulkWrites,
  normalCandidates
}
console.log(JSON.stringify(report,null,2))
if (process.argv.includes('--expect-clean') && normalCandidates.length) process.exitCode = 1
