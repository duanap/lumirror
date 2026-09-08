import { createHash, randomInt } from 'node:crypto'
import { passwordFields } from '../security/passwords.mjs'
import { transaction, json } from '../repositories/sqlite/common.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const digits = (length) => Array.from({length},() => randomInt(10)).join('')
const rules = [
  {id:'ability',name:'工作能力',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'attitude',name:'工作态度',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'collaboration',name:'协作能力',min:60,max:99,weight:100,operation:'add',enabled:true}
]

export async function bootstrapDatabase(storage, env) {
  const database = storage.database
  if (database.prepare('SELECT 1 FROM app_state WHERE singleton=1').get()) return false
  if (!env.INITIAL_ADMIN_PASSWORD) throw new Error('INITIAL_ADMIN_PASSWORD is required for first production bootstrap')
  const fields = await passwordFields(env.INITIAL_ADMIN_PASSWORD,true)
  const demo = env.BOOTSTRAP_DEMO_DATA !== 'false'
  return transaction(database,() => {
    // Multiple starters cannot replace an initialized database after asynchronous hashing.
    if (database.prepare('SELECT 1 FROM app_state WHERE singleton=1').get()) return false
    for (const table of ['users','departments','teams','employees','review_periods','evaluation_activities','verification_codes','evaluation_tasks','scores']) {
      if (database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new Error('Refusing to bootstrap a partially populated database; restore or repair it explicitly')
    }
    const now = new Date().toISOString()
    const user = {id:'user_admin',username:'admin',displayName:'系统管理员',role:'admin',status:'active',departmentId:'',teamId:'',employeeId:'',authVersion:0,createdAt:now,updatedAt:now,...fields}
    database.prepare('INSERT INTO app_state VALUES (1,4,4,?,?,?)').run(now,now,'{}')
    database.prepare('INSERT INTO settings VALUES (1,?,120,90)').run('和光镜鉴')
    database.prepare('INSERT INTO users (id,username,role,status,department_id,team_id,employee_id,payload_json,list_order) VALUES (?,?,?,?,NULL,NULL,NULL,?,0)')
      .run(user.id,user.username,user.role,user.status,json(user))
    if (!demo) return true

    const departments = [
      {id:'dep_rd',name:'技术研发部',leader:'刘主管',sort:1,status:'active'},
      {id:'dep_product',name:'产品中心',leader:'周主管',sort:2,status:'active'}
    ]
    const teams = [
      {id:'team_rd',name:'研发团队',departmentId:'dep_rd',leader:'张三',sort:1,status:'active'},
      {id:'team_pm',name:'产品团队',departmentId:'dep_product',leader:'王敏',sort:2,status:'active'}
    ]
    const names = ['张三','李四','王敏','赵强','陈晓']
    const positions = ['研发工程师','前端工程师','产品经理','测试工程师','UI 设计师']
    const employees = names.map((name,index) => ({id:`emp_00${index+1}`,name,gender:[0,3].includes(index) ? 'male' : 'female',departmentId:'dep_rd',teamId:'team_rd',position:positions[index],status:'active',tagIds:[]}))
    departments.forEach((item,index) => database.prepare('INSERT INTO departments VALUES (?,?,?,?,?,?)').run(item.id,item.name,item.status,item.sort,json(item),index))
    teams.forEach((item,index) => database.prepare('INSERT INTO teams VALUES (?,?,?,?,?,?,?)').run(item.id,item.departmentId,item.name,item.status,item.sort,json(item),index))
    employees.forEach((item,index) => database.prepare('INSERT INTO employees VALUES (?,?,?,?,?,?,?)').run(item.id,item.departmentId,item.teamId,item.name,item.status,json(item),index))
    const startTime = new Date(Date.now()-60000).toISOString()
    const endTime = new Date(Date.now()+90*86400000).toISOString()
    const period = {id:'period_demo',name:'示例评价周期',startTime,endTime,status:'active',anonymous:true,allowRepeat:false,allowModify:false,createdAt:now}
    database.prepare('INSERT INTO review_periods VALUES (?,?,?,?,?,?,0)').run(period.id,period.name,period.status,startTime,endTime,json(period))
    const evaluation = {id:'eval_demo',code:`PJ${digits(4)}`,linkCode:digits(8),name:'研发团队匿名反馈',periodId:period.id,teamId:'team_rd',departmentId:'dep_rd',status:'active',startTime,endTime,rounding:'one_decimal',participantMode:'selected',targetType:'employee',targetMode:'selected',employeeTargetScope:'custom',targetTeamId:'team_rd',targetDepartmentId:'dep_rd',excludeSelf:true,createdAt:now,updatedAt:now}
    database.prepare('INSERT INTO evaluation_activities VALUES (?,?,?,?,?,?,?,?,?,?,?,0)').run(evaluation.id,evaluation.code,evaluation.linkCode,evaluation.name,period.id,'dep_rd','team_rd','active',startTime,endTime,json(evaluation))
    rules.forEach((rule,index) => database.prepare('INSERT INTO evaluation_rules (evaluation_id,rule_id,name,min_value,max_value,weight,operation,enabled,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(evaluation.id,rule.id,rule.name,rule.min,rule.max,rule.weight,rule.operation,1,json(rule),index))
    database.prepare('INSERT INTO evaluation_participants VALUES (?,?,0)').run(evaluation.id,'emp_001')
    employees.forEach((employee,index) => database.prepare('INSERT INTO evaluation_targets VALUES (?,?,?,?)').run(evaluation.id,'employee',employee.id,index))
    const code = digits(6)
    const codeHash = hash(`${evaluation.id}:${code}`)
    const evaluatorHash = hash(`evaluator:${codeHash}`)
    const verify = {id:'verify_demo',evaluationCodeId:evaluation.id,codeHash,codeFingerprint:hash(`employee-review:verify:${code}`),codeMask:`****${code.slice(-2)}`,suffix:code.slice(-2),evaluatorHash,participantEmployeeId:'emp_001',expected:4,submitted:0,remaining:4,status:'unused',firstUsedAt:null,completedAt:null,createdAt:now}
    database.prepare('INSERT INTO verification_codes VALUES (?,?,?,?,?,?,?,0)').run(verify.id,evaluation.id,'emp_001',codeHash,verify.codeFingerprint,'unused',json(verify))
    employees.slice(1).forEach((employee,index) => {
      const task = {id:`task_demo_${index+1}`,evaluationCodeId:evaluation.id,verifyCodeId:verify.id,evaluatorHash,targetType:'employee',targetId:employee.id,targetEmployeeId:employee.id,status:'pending',submittedAt:null}
      database.prepare('INSERT INTO evaluation_tasks VALUES (?,?,?,?,?,?,?,?)').run(task.id,evaluation.id,verify.id,'employee',employee.id,'pending',json(task),index)
    })
    return true
  })
}
