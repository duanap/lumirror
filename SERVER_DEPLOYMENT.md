# Direct server deployment

Lumirror production uses Nginx -> one PM2 fork -> Node.js -> relational SQLite. EdgeOne remains only as a compatibility source tree and is not part of the active production request path.

This document describes deployment of the repository state that keeps **Schema Version 4**. The application version remains `1.5.1`; pin deployments and rollbacks to an exact Git commit SHA.

## Runtime layout

A recommended immutable-release layout is:

```text
/www/wwwroot/duanap/apps/lumirror/
├── current -> releases/<git-sha>/
├── releases/<git-sha>/
│   ├── dist/
│   ├── server/
│   ├── shared/
│   ├── scripts/production-server.mjs
│   └── deploy/ecosystem.config.cjs
└── shared-runtime/
    ├── data/lumirror.sqlite
    └── lumirror.env
```

If the existing server already uses `/www/wwwroot/duanap/apps/lumirror/shared/` for runtime state, keep that path instead of renaming it. The important rule is that the database and environment file live outside immutable release directories and survive a release rollback.

The repository example PM2 configuration expects:

```text
/www/wwwroot/duanap/apps/lumirror/shared/lumirror.env
```

and the default application configuration expects `DATA_DIR` to point to the corresponding shared data directory.

## Required runtime

- Node.js 22
- PM2 with exactly one `lumirror` process in `fork` mode
- Nginx terminating TLS and proxying `/api/` to `127.0.0.1:3020`
- Existing Schema 4 SQLite database, or a completely empty data directory for a first installation

Do not use PM2 cluster mode and do not add a process-wide request queue. SQLite write consistency is provided by short repository transactions and WAL mode.

## Production environment

Start from `.env.example`. A production file should contain values equivalent to:

```dotenv
APP_ENV=production
APP_VERSION=1.5.1
HOST=127.0.0.1
PORT=3020
DATA_DIR=/www/wwwroot/duanap/apps/lumirror/shared/data
ADMIN_TOKEN_SECRET=<random high-entropy secret>
PUBLIC_TOKEN_SECRET=<different random high-entropy secret>
ALLOWED_ORIGINS=https://lumirror.duanap.cn
SESSION_COOKIE_SECURE=true
ADMIN_SESSION_SECONDS=28800
PUBLIC_SESSION_SECONDS=7200
TIMED_INVITE_SECONDS=300
TRUST_PROXY=loopback
BOOTSTRAP_DEMO_DATA=false
```

`ADMIN_TOKEN_SECRET` and `PUBLIC_TOKEN_SECRET` must be different. Keep the environment file mode at `0600` and the data directory at `0700`.

`INITIAL_ADMIN_PASSWORD` is required only when starting against a completely empty database. Existing production databases do not require it. For a fresh installation, set it for the first bootstrap, sign in, change the initial administrator password, then remove the value from the environment file and reload PM2.

Never set `BOOTSTRAP_DEMO_DATA=true` on a fresh production installation unless sample departments, members and an example evaluation are intentionally wanted.

## Repository release gate

The pull request or commit being deployed must have the GitHub CI workflow fully green. The equivalent local commands are:

```bash
npm ci
npm audit
npm run check:functions
npm run test:api
npm run test:server
npm run test:optimization
npm run test:deployment
npm run test:r2:http-concurrency
npm run test:r2:repository-concurrency
npm run test:r2:queue-removal
npm run test:golden
npm run test:r2:domain-closeout
npm run check:snapshot-usage -- --expect-clean
npm run build
npm run docs:validate
npm run docs:build
```

Do not deploy a different commit after validating an earlier SHA.

## Backup before deployment

1. In the admin console, download a **full sensitive backup** from “导入与导出”. Store it as a secret; it contains data intended for disaster recovery and must not be sent through chat or public file sharing.
2. Record the currently deployed Git commit SHA and the current `current` symlink target.
3. Because Schema Version stays at 4, the normal code rollback does not require a database downgrade. For additional protection, take a file-level SQLite backup as well. The simplest cold-copy procedure is to stop the PM2 process, copy `lumirror.sqlite` (and any `-wal`/`-shm` files if they still exist), then restart. If a supported SQLite online-backup tool is already installed, it can be used instead to avoid downtime.

Do not copy only `lumirror.sqlite` while the application is actively writing and assume it is a complete backup.

## Deploy a new immutable release

One safe flow is:

```bash
cd /www/wwwroot/duanap/apps/lumirror
mkdir -p releases/<git-sha>
```

Populate `releases/<git-sha>` from the exact validated commit. Either build on a trusted build host and upload `dist/` plus the runtime source directories, or check out the exact commit in the release directory and run `npm ci && npm run build` there.

The direct-server runtime needs at least:

```text
dist/
server/
shared/
scripts/production-server.mjs
deploy/ecosystem.config.cjs
```

Before switching traffic, confirm the shared environment and data paths are correct. Then atomically repoint `current` to the new release and reload the single PM2 process using the repository ecosystem file.

Verify the local origin first:

```bash
curl --fail http://127.0.0.1:3020/api/health
```

Expected: HTTP 200 with `success: true`, `data.ready: true`, `storageType: "sqlite-relational"`, and `schemaVersion: 4`.

## Nginx configuration

The supplied `deploy/nginx-lumirror.conf`:

- proxies only `/api/` to Node on loopback;
- keeps security headers on `/index.html` and immutable assets;
- disables access logging for `/i/<code>` and `/t/<code>` so evaluator credentials do not enter Nginx logs;
- disables access logging on the HTTP redirect-only listener for the same reason.

Install or update the site configuration only after:

```bash
nginx -t
```

Then reload Nginx using the server's normal service manager. Do not reload when `nginx -t` fails.

Verify HTTPS after reload:

```bash
curl --fail https://lumirror.duanap.cn/api/health
```

Also verify in a browser:

- admin login and `/admin/me`;
- one existing read-only results page;
- one disposable or test invitation flow if available;
- static `/`, an `/assets/...` resource, `/i/<test-code>` and `/t/<test-code>` response headers;
- Nginx access logs do not contain the tested invite/timed-link codes.

## Restore/import behavior

The normal “匿名统计 JSON” export is deliberately not restorable. Only a full sensitive backup can be restored.

Restore now uses a two-step contract:

1. preflight validates the backup and returns a revision/preview hash without changing the database;
2. the confirmed import must present that same revision and preview hash before the atomic replacement is allowed.

A successful restore revokes existing evaluator sessions; admin session state is refreshed by the response. This is intentional.

## Rollback

For an application-only rollback:

1. repoint `current` to the recorded previous release SHA;
2. reload the single `lumirror` PM2 process;
3. verify `http://127.0.0.1:3020/api/health`;
4. if the Nginx file changed, restore the prior Nginx configuration, run `nginx -t`, then reload Nginx;
5. verify the public HTTPS health endpoint and a login/read flow.

Because this release remains on Schema Version 4, rolling the application back to the previous Schema 4 release does not require a schema downgrade.

If the database itself must be rolled back, stop Lumirror first and restore the separately captured database backup or use the application's validated full-backup restore procedure. Never overwrite a live SQLite database file while the PM2 process is writing to it.
