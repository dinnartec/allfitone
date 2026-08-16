import { createServer } from 'node:http'

const port = Number(process.env.POSTMAN_FIXTURE_PORT ?? 4010)
const host = '127.0.0.1'

const telemetryPaths = new Set([
  '/backoffice/v1/telemetry-config',
  '/space/v1/telemetry-config',
  '/studio/v1/telemetry-config',
])

const server = createServer((request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405, { 'Content-Type': 'application/problem+json' })
    response.end(JSON.stringify({ type: 'about:blank', title: 'Method Not Allowed', status: 405 }))
    return
  }
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }
  if (telemetryPaths.has(request.url)) {
    response.writeHead(200, {
      'Cache-Control': 'public, max-age=300',
      'Content-Type': 'application/json',
      'Server-Timing': 'app;dur=1',
    })
    response.end(JSON.stringify({ enabled: false, notice_version: 'analytics-v1' }))
    return
  }
  response.writeHead(404, { 'Content-Type': 'application/problem+json' })
  response.end(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }))
})

server.listen(port, host, () => {
  console.log(`Postman smoke fixture listening on http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
