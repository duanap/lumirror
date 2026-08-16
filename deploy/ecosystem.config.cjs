module.exports = {
  apps: [{
    name: 'lumirror',
    cwd: '/www/wwwroot/duanap/apps/lumirror/current',
    script: 'scripts/production-server.mjs',
    interpreter: 'node',
    node_args: '--env-file=/www/wwwroot/duanap/apps/lumirror/shared/lumirror.env',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '256M',
    kill_timeout: 12000,
    time: true,
    env: {
      APP_ENV: 'production'
    }
  }]
}
