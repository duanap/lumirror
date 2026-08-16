# Direct server deployment

This deployment does not use EdgeOne. Nginx serves `dist`, proxies `/api/` to a single PM2-managed Node process on `127.0.0.1:3020`, and terminates TLS for `lumirror.duanap.cn`.

## Runtime layout

```text
/www/wwwroot/duanap/apps/lumirror/
├── current -> releases/<release-id>
├── releases/<release-id>/
│   ├── dist/
│   ├── edge-functions/
│   ├── scripts/production-server.mjs
│   └── deploy/ecosystem.config.cjs
└── shared/
    ├── data/employee-review-db.json
    └── lumirror.env
```

`shared/lumirror.env` and `shared/data` must be readable only by the service owner. The environment file contains:

```dotenv
APP_ENV=production
HOST=127.0.0.1
PORT=3020
DATA_DIR=/www/wwwroot/duanap/apps/lumirror/shared/data
ADMIN_TOKEN_SECRET=<random secret>
PUBLIC_TOKEN_SECRET=<different random secret>
INITIAL_ADMIN_PASSWORD=<one-time bootstrap password>
ALLOWED_ORIGINS=https://lumirror.duanap.cn
SESSION_COOKIE_SECURE=true
```

After the first successful admin login and password change, remove `INITIAL_ADMIN_PASSWORD` from the environment file and restart the PM2 process. Existing data does not depend on this value.

## Release checks

```bash
npm ci
npm run check:functions
npm run test:api
npm run test:server
npm run build
```

Upload only runtime files into a new immutable release directory, repoint `current` atomically, and start or reload `deploy/ecosystem.config.cjs`. Install `deploy/nginx-lumirror.conf` as the site configuration only after `nginx -t` succeeds.

Verify the origin before changing DNS:

```bash
curl --resolve lumirror.duanap.cn:443:<server-ip> https://lumirror.duanap.cn/api/health
```

The expected response has HTTP 200 and `data.ready: true`. Then replace the EdgeOne CNAME with a direct A record to the server and verify the public URL again.

## Rollback

Repoint `current` to the previous release, reload `lumirror` in PM2, run `nginx -t`, and reload Nginx. The database remains in `shared/data` and is not changed by a code rollback; take a separate data snapshot before any data-format migration.
