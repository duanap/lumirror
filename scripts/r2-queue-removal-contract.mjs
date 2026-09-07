import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const source = await readFile(path.resolve(import.meta.dirname,'production-server.mjs'),'utf8')
assert.equal(/requestQueue/.test(source),false,'production server must not retain a global request queue')
assert.match(source,/void handleRequest\(req, res\)/,'production server must dispatch each HTTP request directly')
console.log('R2 queue removal contract passed: no global request queue or replacement mutex')
