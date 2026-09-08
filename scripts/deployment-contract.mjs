import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname,'..')
const nginx = await readFile(path.join(root,'deploy/nginx-lumirror.conf'),'utf8')
const production = await readFile(path.join(root,'scripts/production-server.mjs'),'utf8')
const require = createRequire(import.meta.url)
const ecosystem = require(path.join(root,'deploy/ecosystem.config.cjs'))
const app = ecosystem?.apps?.find((item) => item.name === 'lumirror')

assert.ok(app,'PM2 must define the lumirror application')
assert.equal(app.instances,1,'SQLite production must remain one PM2 process')
assert.equal(app.exec_mode,'fork','SQLite production must remain in PM2 fork mode')
assert.equal(app.script,'scripts/production-server.mjs')
assert.match(production,/process\.env\.HOST \|\| '127\.0\.0\.1'/,'production server must bind loopback by default')
assert.match(production,/TRUST_PROXY:process\.env\.TRUST_PROXY \|\| 'loopback'/,'trusted proxy default must stay loopback-only')

const redirectServer = nginx.match(/server \{[\s\S]*?listen 80;[\s\S]*?\n\}/)?.[0] || ''
assert.match(redirectServer,/access_log off;/,'HTTP redirect server must not log credential-bearing request URIs')
const inviteLocation = nginx.match(/location ~ \^\/\(\?:i\|t\)\/[\s\S]*?\n    \}/)?.[0] || ''
assert.match(inviteLocation,/access_log off;/,'invite and timed-link SPA paths must not enter Nginx access logs')
assert.match(inviteLocation,/try_files \$uri \$uri\/ \/index\.html;/)

for (const location of ['location = /index.html','location /assets/']) {
  const start = nginx.indexOf(location)
  assert.ok(start >= 0,`${location} must exist`)
  const end = nginx.indexOf('\n    }',start)
  const block = nginx.slice(start,end)
  for (const header of ['Strict-Transport-Security','X-Frame-Options','X-Content-Type-Options','Referrer-Policy','Permissions-Policy','Content-Security-Policy']) {
    assert.ok(block.includes(`add_header ${header}`),`${location} must retain ${header}`)
  }
}

console.log('Deployment contract passed: single-fork Node/SQLite, loopback proxy trust, security headers and invite-log privacy')
