import { readFile } from 'node:fs/promises'
import path from 'node:path'

const sourcePath = path.resolve(import.meta.dirname,'../edge-functions/api/[[default]].js')
const source = await readFile(sourcePath,'utf8')
const lines = source.split('\n')
const calls = []
for (let index = 0; index < lines.length; index += 1) {
  if (!/await saveDatabase\(context,db\)/.test(lines[index])) continue
  const context = lines.slice(Math.max(0,index - 12),index + 1).join('\n')
  const maintenance = /import\/json|export\/json|export\/full-json|maintenance\/cleanup/.test(context)
  calls.push({line:index + 1,kind:maintenance ? 'maintenance-or-export-candidate' : 'normal-mutation-candidate',text:lines[index].trim()})
}
const normal = calls.filter((call) => call.kind === 'normal-mutation-candidate')
console.log(JSON.stringify({source:sourcePath,totalCalls:calls.length,normalSnapshotMutationCandidates:normal.length,calls},null,2))
if (process.argv.includes('--expect-clean') && normal.length) process.exitCode = 1
