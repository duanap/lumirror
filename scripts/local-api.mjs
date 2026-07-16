import http from 'node:http'
import onRequest from '../edge-functions/api/[[default]].js'

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const request = new Request(`http://127.0.0.1:8088${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : body
  })
  const response = await onRequest({ request, params: {}, env: { APP_ENV: 'development', ADMIN_TOKEN_SECRET: 'local-admin-secret', PUBLIC_TOKEN_SECRET: 'local-public-secret' } })
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  res.end(Buffer.from(await response.arrayBuffer()))
})

server.listen(8088, '127.0.0.1', () => console.log('Local API listening on http://127.0.0.1:8088'))
