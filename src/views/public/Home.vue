<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowRight,
  Calendar,
  Check,
  Connection,
  DataAnalysis,
  Key,
  Lock,
  Setting,
  TrendCharts,
  UserFilled
} from '@element-plus/icons-vue'
import { api } from '../../lib/api'

const router = useRouter()
const form = reactive({ evaluationCode: '', verifyCode: '' })
const loading = ref(false)

const trustPoints = [
  {
    icon: Key,
    number: '01',
    title: '独立凭证，先确认资格',
    copy: '活动码与邀请码共同校验参与资格。凭证失效、重复使用或活动结束后，系统会拒绝进入。'
  },
  {
    icon: Lock,
    number: '02',
    title: '匿名记录，隔离个人结果',
    copy: '公开评价端不展示评价人身份与个人评分结果，提交内容以匿名标识进入评价记录。'
  },
  {
    icon: DataAnalysis,
    number: '03',
    title: '统一规则，服务端计算',
    copy: '评分范围、评价任务与计算规则均由服务端复核，减少前端篡改和口径不一致。'
  }
]

const steps = [
  { index: '1', title: '创建评价活动', copy: '按周期配置对象、维度和计分规则。' },
  { index: '2', title: '分发评价凭证', copy: '使用活动码、邀请码或一次性时效链接。' },
  { index: '3', title: '完成匿名评价', copy: '逐人评分，系统实时校验并保存进度。' },
  { index: '4', title: '查看汇总洞察', copy: '在权限边界内查看完成进度与汇总结果。' }
]

const features = [
  { icon: Calendar, title: '周期评价活动', copy: '将一轮评价的成员、任务、链接与结果收拢在同一活动中。' },
  { icon: Setting, title: '灵活评分规则', copy: '自定义评分维度、分值范围、增减计入、权重与取整方式。' },
  { icon: TrendCharts, title: '过程与结果洞察', copy: '跟踪参与人数、完成率、待办任务和团队综合表现。' },
  { icon: UserFilled, title: '组织与角色权限', copy: '按部门、团队和角色控制后台功能与可见数据范围。' },
  { icon: Connection, title: '多种安全入口', copy: '支持邀请码入口与打开后仅 5 分钟有效的一次性时效链接。' },
  { icon: DataAnalysis, title: '业务数据沉淀', copy: '成员、活动、任务、规则与评分统一存入 SQLite，便于备份管理。' }
]

function normalizeCode(field: 'evaluationCode' | 'verifyCode', length: number) {
  form[field] = form[field].replace(/\D/g, '').slice(0, length)
}

function storeSession(result: any) {
  if (result.token) sessionStorage.setItem('public_token', result.token)
  sessionStorage.setItem('evaluation_summary', JSON.stringify({
    evaluation: result.evaluation,
    remaining: result.remaining,
    timed: result.timed,
    expiresAt: result.expiresAt
  }))
}

async function enterEvaluation() {
  if (!/^\d{8}$/.test(form.evaluationCode)) return ElMessage.warning('请输入 8 位数字活动码')
  if (!/^\d{6}$/.test(form.verifyCode)) return ElMessage.warning('请输入 6 位数字邀请码')
  loading.value = true
  try {
    const result = await api.post('/public/verify-entry', form)
    storeSession(result)
    await router.push('/evaluate')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '校验失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="home-page">
    <header class="site-header">
      <a class="brand" href="#top" aria-label="和光镜鉴首页">
        <span class="brand-mark">L</span>
        <span class="brand-name">和光镜鉴</span>
        <span class="brand-en">Lumirror</span>
      </a>
      <nav aria-label="首页导航">
        <a href="#fairness">公平与匿名</a>
        <a href="#workflow">使用流程</a>
        <a href="#features">主要功能</a>
      </nav>
      <a class="admin-link" href="/admin/login">后台登录</a>
    </header>

    <main id="top">
      <section class="hero section-wrap">
        <div class="hero-copy">
          <span class="eyebrow"><i></i> 为真实反馈建立安全边界</span>
          <h1>让反馈匿名，<br><em>让成长更公平。</em></h1>
          <p>和光镜鉴是一套面向团队的匿名评价系统。它用独立凭证确认评价资格，用统一规则校验每次评分，并在明确的权限边界内沉淀可信的团队反馈。</p>
          <div class="hero-actions">
            <a class="primary-action" href="#entry">开始评价 <el-icon><ArrowRight /></el-icon></a>
            <a class="secondary-action" href="#fairness">了解匿名机制</a>
          </div>
          <ul class="hero-checks" aria-label="产品特点">
            <li><el-icon><Check /></el-icon> 凭证校验</li>
            <li><el-icon><Check /></el-icon> 匿名记录</li>
            <li><el-icon><Check /></el-icon> 服务端统一计算</li>
          </ul>
        </div>

        <div class="hero-visual" aria-label="匿名评价流程示意">
          <div class="visual-glow"></div>
          <div class="score-window">
            <div class="window-head">
              <span><i></i><i></i><i></i></span>
              <b>匿名评价进行中</b>
              <small>2 / 6</small>
            </div>
            <div class="person-row">
              <div class="anonymous-avatar"><el-icon :size="28"><UserFilled /></el-icon></div>
              <div><small>正在评价</small><strong>团队成员</strong></div>
              <span class="privacy-tag"><el-icon><Lock /></el-icon> 身份已隐藏</span>
            </div>
            <div class="mock-score"><span>工作能力</span><i><b style="width: 88%"></b></i><strong>88</strong></div>
            <div class="mock-score"><span>工作态度</span><i><b style="width: 92%"></b></i><strong>92</strong></div>
            <div class="mock-score"><span>协作能力</span><i><b style="width: 90%"></b></i><strong>90</strong></div>
            <div class="mock-total"><span>综合总分</span><strong>90.0</strong></div>
          </div>
          <div class="floating-note note-safe"><el-icon><Check /></el-icon><span><b>规则校验通过</b><small>评分由服务端复核</small></span></div>
          <div class="floating-note note-lock"><el-icon><Lock /></el-icon><span><b>匿名提交</b><small>不展示个人结果</small></span></div>
        </div>
      </section>

      <section id="fairness" class="trust-section">
        <div class="section-wrap">
          <div class="section-heading centered">
            <span class="eyebrow">公平不是口号，而是一套机制</span>
            <h2>每一条反馈，都经过同样的边界</h2>
            <p>从进入活动到提交评分，资格、身份与计算规则分别处理，让评价更专注于内容本身。</p>
          </div>
          <div class="trust-grid">
            <article v-for="item in trustPoints" :key="item.number" class="trust-card">
              <span class="card-number">{{ item.number }}</span>
              <div class="card-icon"><el-icon :size="24"><component :is="item.icon" /></el-icon></div>
              <h3>{{ item.title }}</h3>
              <p>{{ item.copy }}</p>
            </article>
          </div>
          <div class="boundary-note">
            <el-icon :size="20"><Lock /></el-icon>
            <p><strong>清晰的隐私边界：</strong>公开评价端与被评价成员不展示单次评分和评价人身份；后台数据按角色权限访问，用于活动管理与汇总分析。</p>
          </div>
        </div>
      </section>

      <section id="workflow" class="workflow-section section-wrap">
        <div class="section-heading">
          <span class="eyebrow">简单清晰的评价流程</span>
          <h2>从发起到洞察，四步完成</h2>
        </div>
        <div class="steps">
          <article v-for="step in steps" :key="step.index" class="step-card">
            <span>{{ step.index }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.copy }}</p>
          </article>
        </div>
      </section>

      <section id="features" class="features-section">
        <div class="section-wrap">
          <div class="section-heading centered">
            <span class="eyebrow">覆盖一轮评价的完整工作</span>
            <h2>不止匿名，也更好管理</h2>
          </div>
          <div class="feature-grid">
            <article v-for="feature in features" :key="feature.title" class="feature-card">
              <div class="feature-icon"><el-icon :size="23"><component :is="feature.icon" /></el-icon></div>
              <div><h3>{{ feature.title }}</h3><p>{{ feature.copy }}</p></div>
            </article>
          </div>
        </div>
      </section>

      <section id="entry" class="entry-section section-wrap">
        <div class="entry-copy">
          <span class="eyebrow">已有评价凭证？</span>
          <h2>现在开始你的匿名评价</h2>
          <p>输入管理员分发的 8 位活动码和 6 位邀请码。邀请码仅用于确认参与资格，提交后不可重复使用。</p>
          <div class="entry-promise"><el-icon><Lock /></el-icon><span><b>评价过程受保护</b><small>公开端不展示你的个人评分结果</small></span></div>
        </div>
        <form class="entry-form" @submit.prevent="enterEvaluation">
          <label for="evaluation-code">活动码</label>
          <div class="code-field">
            <el-icon :size="19"><Connection /></el-icon>
            <input id="evaluation-code" v-model="form.evaluationCode" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="请输入 8 位数字" @input="normalizeCode('evaluationCode', 8)" />
          </div>
          <label for="verify-code">邀请码</label>
          <div class="code-field">
            <el-icon :size="19"><Key /></el-icon>
            <input id="verify-code" v-model="form.verifyCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" type="password" placeholder="请输入 6 位数字" @input="normalizeCode('verifyCode', 6)" />
          </div>
          <button type="submit" :disabled="loading">
            {{ loading ? '正在校验...' : '进入评价' }}
            <el-icon><ArrowRight /></el-icon>
          </button>
          <small>如果收到的是一次性时效链接，请直接打开该链接进入。</small>
        </form>
      </section>
    </main>

    <footer>
      <div class="section-wrap footer-inner">
        <div class="brand footer-brand"><span class="brand-mark">L</span><span class="brand-name">和光镜鉴</span><span class="brand-en">Lumirror</span></div>
        <p>匿名反馈 · 公平成长</p>
        <a href="/admin/login">管理员入口 <el-icon><ArrowRight /></el-icon></a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.home-page{min-height:100vh;color:var(--text);background:#fffaf6;--home-max:1180px;--home-ease:cubic-bezier(.22,1,.36,1)}
.section-wrap{width:min(var(--home-max),calc(100% - 48px));margin:0 auto}.site-header{position:relative;z-index:10;display:flex;align-items:center;justify-content:space-between;width:min(var(--home-max),calc(100% - 48px));height:78px;margin:0 auto;border-bottom:1px solid rgba(218,191,173,.55)}
.brand{display:flex;align-items:center;gap:10px}.brand-mark{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-2));box-shadow:0 8px 20px rgba(233,91,44,.19);font-size:18px;font-weight:850}.brand-name{color:var(--ink);font-size:17px;font-weight:800}.brand-en{padding-left:10px;border-left:1px solid var(--line);color:var(--subtle);font-size:12px;letter-spacing:.08em}.site-header nav{display:flex;align-items:center;gap:34px}.site-header nav a,.admin-link{color:#665b54;font-size:14px;font-weight:650;transition:color .2s}.site-header nav a:hover,.admin-link:hover{color:var(--brand)}.admin-link{padding:9px 16px;border:1px solid #dfcfc4;border-radius:999px;background:rgba(255,255,255,.62)}
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(460px,.88fr);align-items:center;gap:70px;min-height:650px;padding-top:60px;padding-bottom:86px}.hero-copy{position:relative;z-index:2}.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--brand-dark);font-size:13px;font-weight:760;letter-spacing:.05em}.eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 5px rgba(233,91,44,.1)}.hero h1{max-width:650px;margin:20px 0 24px;color:var(--ink);font-size:clamp(48px,5.4vw,72px);font-weight:850;letter-spacing:-.045em;line-height:1.08}.hero h1 em{color:var(--brand);font-style:normal}.hero-copy>p{max-width:610px;margin:0;color:#6e625b;font-size:17px;line-height:1.9}.hero-actions{display:flex;gap:12px;margin-top:34px}.primary-action,.secondary-action{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:52px;padding:0 24px;border-radius:999px;font-size:15px;font-weight:760;transition:transform .2s var(--home-ease),box-shadow .2s var(--home-ease),background-color .2s}.primary-action{color:#fff;background:linear-gradient(105deg,var(--brand),#f58431);box-shadow:0 14px 30px rgba(233,91,44,.23)}.primary-action:hover{box-shadow:0 18px 34px rgba(233,91,44,.28);transform:translateY(-2px)}.secondary-action{border:1px solid #dfcfc4;color:#5b5049;background:#fff}.secondary-action:hover{background:var(--brand-pale)}.primary-action:active,.secondary-action:active,.entry-form button:active{transform:scale(.97)}.hero-checks{display:flex;flex-wrap:wrap;gap:22px;margin:28px 0 0;padding:0;color:#746861;font-size:13px;list-style:none}.hero-checks li{display:flex;align-items:center;gap:6px}.hero-checks .el-icon{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;color:#fff;background:#2a9662;font-size:12px}
.hero-visual{position:relative;min-height:470px}.visual-glow{position:absolute;inset:2% -10% -5% 5%;border-radius:50%;background:radial-gradient(circle,rgba(246,170,104,.32),rgba(255,232,211,.25) 46%,transparent 70%);filter:blur(12px)}.score-window{position:absolute;inset:34px 14px 30px 24px;padding:22px;border:1px solid rgba(225,194,174,.76);border-radius:24px;background:rgba(255,255,255,.93);box-shadow:0 32px 76px rgba(92,57,37,.17);backdrop-filter:blur(12px);transform:rotate(1.2deg)}.window-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding-bottom:17px;border-bottom:1px solid #eee2da}.window-head>span{display:flex;gap:5px}.window-head i{width:7px;height:7px;border-radius:50%;background:#f2b598}.window-head i:nth-child(2){background:#f5cb83}.window-head i:nth-child(3){background:#91cfa9}.window-head b{color:#564b44;font-size:13px}.window-head small{justify-self:end;color:#9a8e86}.person-row{display:flex;align-items:center;gap:12px;margin:23px 0 26px}.anonymous-avatar{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;color:var(--brand);background:var(--brand-soft)}.person-row>div:nth-child(2){display:flex;flex-direction:column}.person-row small{color:var(--subtle);font-size:11px}.person-row strong{color:var(--ink);font-size:15px}.privacy-tag{display:flex;align-items:center;gap:5px;margin-left:auto;padding:7px 10px;border-radius:999px;color:#1e7d4c;background:#e9f7ef;font-size:11px;font-weight:720}.mock-score{display:grid;grid-template-columns:76px 1fr 34px;align-items:center;gap:12px;margin:19px 0;color:#6d625b;font-size:12px}.mock-score>i{height:7px;overflow:hidden;border-radius:99px;background:#f2e7df}.mock-score>i b{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--brand),var(--brand-2))}.mock-score strong{text-align:right;color:var(--ink);font-size:13px}.mock-total{display:flex;align-items:end;justify-content:space-between;margin-top:27px;padding:18px 3px 0;border-top:1px solid #eee2da;color:#746861;font-size:13px}.mock-total strong{color:var(--brand);font-size:28px;line-height:1}.floating-note{position:absolute;z-index:3;display:flex;align-items:center;gap:10px;min-width:182px;padding:12px 15px;border:1px solid rgba(223,203,190,.8);border-radius:14px;background:rgba(255,255,255,.95);box-shadow:0 16px 36px rgba(74,47,30,.13)}.floating-note>.el-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px}.floating-note span{display:flex;flex-direction:column}.floating-note b{color:#4d433d;font-size:12px}.floating-note small{margin-top:2px;color:#958982;font-size:10px}.note-safe{right:-25px;top:4px}.note-safe>.el-icon{color:#1d8b52;background:#e9f7ef}.note-lock{bottom:0;left:-14px}.note-lock>.el-icon{color:var(--brand);background:var(--brand-soft)}
.trust-section,.features-section{padding:104px 0;background:#fff}.section-heading{max-width:670px;margin-bottom:42px}.section-heading.centered{margin-right:auto;margin-left:auto;text-align:center}.section-heading h2,.entry-copy h2{margin:12px 0 14px;color:var(--ink);font-size:clamp(32px,4vw,46px);line-height:1.18;letter-spacing:-.03em}.section-heading p{margin:0;color:var(--muted);font-size:15px;line-height:1.8}.trust-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.trust-card{position:relative;min-height:258px;padding:30px;border:1px solid #eee1d8;border-radius:20px;background:linear-gradient(150deg,#fff,#fffaf7);box-shadow:0 12px 30px rgba(74,48,32,.05)}.card-number{position:absolute;top:24px;right:25px;color:#e9ded6;font-size:24px;font-weight:850}.card-icon,.feature-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;color:var(--brand);background:var(--brand-soft)}.trust-card h3,.feature-card h3,.step-card h3{margin:23px 0 10px;color:var(--ink);font-size:17px}.trust-card p,.feature-card p,.step-card p{margin:0;color:var(--muted);font-size:14px;line-height:1.75}.boundary-note{display:flex;align-items:flex-start;gap:11px;max-width:900px;margin:24px auto 0;padding:17px 21px;border:1px solid #ecdacc;border-radius:14px;color:#6c5d54;background:#fff8f2}.boundary-note .el-icon{flex:0 0 auto;margin-top:2px;color:var(--brand)}.boundary-note p{margin:0;font-size:13px;line-height:1.7}.boundary-note strong{color:#4e433c}
.workflow-section{padding-top:108px;padding-bottom:112px}.steps{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:18px}.steps:before{position:absolute;top:24px;right:10%;left:10%;height:1px;background:#e5cfc0;content:""}.step-card{position:relative;padding:0 14px}.step-card>span{position:relative;z-index:1;display:grid;place-items:center;width:48px;height:48px;border:7px solid #fffaf6;border-radius:50%;color:#fff;background:var(--brand);box-shadow:0 0 0 1px #edcbb5;font-size:13px;font-weight:800}.step-card h3{margin-top:20px}
.features-section{padding-top:104px;padding-bottom:112px;background:#281f1a}.features-section .eyebrow{color:#ff9c70}.features-section .section-heading h2{color:#fff}.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.feature-card{display:flex;align-items:flex-start;gap:16px;min-height:158px;padding:25px;border:1px solid rgba(255,255,255,.09);border-radius:18px;background:rgba(255,255,255,.045)}.feature-icon{flex:0 0 auto;color:#ff996c;background:rgba(255,122,69,.13)}.feature-card h3{margin:2px 0 8px;color:#fff}.feature-card p{color:#bdb0a8}
.entry-section{display:grid;grid-template-columns:1fr 450px;align-items:center;gap:90px;padding-top:112px;padding-bottom:116px}.entry-copy>p{max-width:570px;margin:0;color:var(--muted);font-size:15px;line-height:1.85}.entry-promise{display:flex;align-items:center;gap:11px;margin-top:26px}.entry-promise>.el-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;color:#1c8250;background:#e7f5ed}.entry-promise span{display:flex;flex-direction:column}.entry-promise b{color:#4f443d;font-size:13px}.entry-promise small{margin-top:2px;color:var(--subtle)}.entry-form{padding:30px;border:1px solid #ead9ce;border-radius:22px;background:#fff;box-shadow:0 24px 56px rgba(79,49,32,.11)}.entry-form label{display:block;margin:0 0 8px;color:#4f443d;font-size:13px;font-weight:720}.entry-form label:not(:first-child){margin-top:17px}.code-field{display:flex;align-items:center;gap:10px;height:50px;padding:0 14px;border:1.5px solid #e6d7cd;border-radius:12px;color:var(--brand);background:#fff;transition:border-color .2s,box-shadow .2s}.code-field:focus-within{border-color:var(--brand);box-shadow:var(--focus)}.code-field input{width:100%;border:0;outline:0;color:var(--ink);background:transparent;font-size:15px}.entry-form button{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:52px;margin-top:24px;border:0;border-radius:999px;color:#fff;background:linear-gradient(105deg,var(--brand),var(--brand-2));box-shadow:0 12px 26px rgba(233,91,44,.2);font-weight:760;cursor:pointer;transition:transform .2s var(--home-ease),opacity .2s}.entry-form button:disabled{opacity:.62;cursor:wait}.entry-form>small{display:block;margin:13px 4px 0;color:var(--subtle);font-size:11px;line-height:1.6;text-align:center}
footer{border-top:1px solid #eadfd7;background:#fff}.footer-inner{display:flex;align-items:center;min-height:94px}.footer-brand .brand-mark{width:30px;height:30px;border-radius:9px;font-size:15px}.footer-inner>p{margin:0 auto;color:var(--subtle);font-size:12px;letter-spacing:.08em}.footer-inner>a{display:flex;align-items:center;gap:5px;color:#6b5f57;font-size:13px;font-weight:650}
@media(max-width:980px){.site-header nav{display:none}.hero{grid-template-columns:1fr;gap:22px;min-height:auto;padding-top:80px}.hero-copy{text-align:center}.hero-copy>p{margin-right:auto;margin-left:auto}.hero-actions,.hero-checks{justify-content:center}.hero-visual{width:min(560px,100%);margin:0 auto}.trust-grid,.feature-grid{grid-template-columns:repeat(2,1fr)}.steps{grid-template-columns:repeat(2,1fr);row-gap:42px}.steps:before{display:none}.entry-section{grid-template-columns:1fr 420px;gap:42px}}
@media(max-width:700px){.section-wrap,.site-header{width:min(100% - 28px,var(--home-max))}.site-header{height:68px}.brand-en{display:none}.admin-link{padding:8px 13px}.hero{padding-top:58px;padding-bottom:74px}.hero h1{font-size:clamp(40px,12vw,56px)}.hero-copy>p{font-size:15px;line-height:1.8}.hero-actions{flex-direction:column}.primary-action,.secondary-action{width:100%}.hero-checks{gap:11px 15px}.hero-visual{min-height:410px}.score-window{inset:38px 0 22px;padding:18px;border-radius:20px}.floating-note{min-width:164px}.note-safe{right:-3px}.note-lock{left:-3px}.trust-section,.features-section{padding:78px 0}.trust-grid,.feature-grid,.steps,.entry-section{grid-template-columns:1fr}.trust-card{min-height:auto;padding:25px}.workflow-section{padding-top:80px;padding-bottom:84px}.steps{gap:30px}.step-card{padding:0}.feature-card{min-height:auto}.entry-section{gap:34px;padding-top:82px;padding-bottom:84px}.entry-form{padding:24px 20px}.footer-inner{flex-wrap:wrap;gap:15px;padding:22px 0}.footer-inner>p{order:3;width:100%;margin:0}.footer-inner>a{margin-left:auto}}
@media(max-width:430px){.brand-name{font-size:15px}.hero-visual{min-height:380px}.score-window{padding:15px}.window-head{grid-template-columns:1fr auto}.window-head small{display:none}.person-row{margin:18px 0 22px}.privacy-tag{padding:6px 8px}.mock-score{margin:16px 0}.floating-note{min-width:148px;padding:10px}.note-lock{bottom:-3px}.section-heading h2,.entry-copy h2{font-size:32px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.primary-action,.secondary-action,.entry-form button{transition:none}.primary-action:hover{transform:none}}
</style>
