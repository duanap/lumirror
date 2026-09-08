import { AppError, parseJson } from './common.mjs'
import { activityStatus } from '../../domain/activity.mjs'
import { can } from '../../security/permissions.mjs'

const round = (value) => Math.round(Number(value)*10)/10
const defaultRules = [
  {id:'ability',name:'工作能力',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'attitude',name:'工作态度',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'collaboration',name:'协作能力',min:60,max:99,weight:100,operation:'add',enabled:true}
]

export class SqliteQueryRepository {
  constructor({storage,scoreRepository,employeeRepository,periodRepository}) {
    this.storage = storage
    this.database = storage.database
    this.scoreRepository = scoreRepository
    this.employeeRepository = employeeRepository
    this.periodRepository = periodRepository
  }
  dashboard(session, evaluationId = '') {
    if (!can(session,'dashboard:view')) throw new AppError('无权访问',403,'FORBIDDEN')
    if (session.role === 'member') return {mode:'member',role:'member',activities:[],canSeeScores:false}
    const rows = this.scoreRepository.visibleEvaluationRows(session)
    const activities = this.scoreRepository.evaluationViews(rows).map((item) => ({...item,status:activityStatus(item)}))
    const selected = activities.find((item) => item.id === evaluationId) || activities.find((item) => item.status === 'active') || activities.at(-1)
    const teamIds = [...this.employeeRepository.visibleTeamIds(session)]
    const employeeCount = teamIds.length ? Number(this.database.prepare(`SELECT COUNT(*) AS value FROM employees WHERE team_id IN (${teamIds.map(() => '?').join(',')})`).get(...teamIds).value) : 0
    const ids = rows.map((row) => row.id)
    const averages = new Map(ids.length ? this.database.prepare(`SELECT evaluation_id,AVG(total) AS average FROM scores WHERE evaluation_id IN (${ids.map(() => '?').join(',')}) GROUP BY evaluation_id`).all(...ids).map((row) => [row.evaluation_id,round(row.average)]) : [])
    const groups = new Map()
    for (const item of activities) {
      if (!groups.has(item.teamId)) groups.set(item.teamId,{teamId:item.teamId,teamName:item.teamName,departmentName:item.departmentName,activityCount:0,participants:0,completed:0,completionRate:0,activities:[]})
      const group = groups.get(item.teamId)
      group.activityCount += 1
      group.participants += item.participantCount
      group.completed += item.completedParticipants
      group.activities.push({id:item.id,name:item.name,status:item.status,participantCount:item.participantCount,completedParticipants:item.completedParticipants,pendingParticipants:item.pendingParticipants,completionRate:item.completionRate,targetCount:item.targetCount,taskCount:item.taskCount,averageScore:averages.get(item.id) ?? '--'})
      group.completionRate = group.participants ? Math.round(group.completed/group.participants*100) : 0
    }
    return {
      ...(selected || {}),participants:selected?.participantCount || 0,completed:selected?.completedParticipants || 0,pending:selected?.pendingParticipants || 0,
      completionRate:selected?.completionRate || 0,employeeCount,averageScore:averages.get(selected?.id) ?? '--',persistentKV:true,role:session.role,canSeeScores:can(session,'results:view'),
      activities:activities.map((item) => ({id:item.id,name:item.name,status:item.status,teamId:item.teamId,teamName:item.teamName})),teamGroups:[...groups.values()]
    }
  }
  evaluationOptions(session) {
    if (!can(session,'activities:view')) throw new AppError('无权访问',403,'FORBIDDEN')
    const result = this.employeeRepository.list(session,{status:'active'})
    return {periods:this.periodRepository.list(),departments:result.options.departments.filter((item) => item.status !== 'inactive'),teams:result.options.teams.filter((item) => item.status !== 'inactive'),employees:result.items,defaultRules:structuredClone(defaultRules)}
  }
  deploymentCheck(env) {
    const mode = this.database.prepare('PRAGMA journal_mode').get().journal_mode
    const sync = Number(this.database.prepare('PRAGMA synchronous').get().synchronous)
    const pendingPassword = Number(this.database.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND status='active' AND json_extract(payload_json,'$.mustChangePassword')=1").get().value)
    const checks = [
      {id:'storage',label:'SQLite',status:this.storage.readiness() ? 'pass' : 'fail',message:'Relational storage / Schema 4'},
      {id:'durability',label:'WAL / FULL',status:mode === 'wal' && sync === 2 ? 'pass' : 'warn',message:`journal_mode=${mode}, synchronous=${sync}`},
      {id:'secrets',label:'会话密钥',status:env.ADMIN_TOKEN_SECRET && env.PUBLIC_TOKEN_SECRET ? 'pass' : 'fail',message:'只检查配置是否存在，不返回密钥'},
      {id:'initial-password',label:'初始密码',status:pendingPassword ? 'warn' : 'pass',message:pendingPassword ? '仍有管理员需修改初始密码' : '启用管理员已完成初始密码修改'},
      {id:'deployment',label:'部署边界',status:'warn',message:'请按部署清单确认 Nginx 响应头、备份和 PM2 单 fork；本检查不读取服务器配置'}
    ]
    return {checks,summary:{pass:checks.filter((item) => item.status === 'pass').length,warn:checks.filter((item) => item.status === 'warn').length,fail:checks.filter((item) => item.status === 'fail').length}}
  }
}
