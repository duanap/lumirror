# Repository Guidelines

## Production architecture

Lumirror is a Vue 3 + TypeScript + Vite application. Production uses Nginx, one Node.js process managed by PM2 in fork mode, and relational SQLite. The global request queue has been removed. Do not restore a global request mutex or enable PM2 cluster mode as a shortcut.

- `src/`: frontend views, components, layouts, API clients and styles.
- `scripts/production-server.mjs`: production HTTP entrypoint and dependency assembly.
- `server/`: Node routing, request context, security, business services and SQLite repositories.
- `scripts/sqlite-storage.mjs`: relational schema, migrations and maintenance snapshot adapter.
- `edge-functions/api/[[default]].js`: retained EdgeOne compatibility runtime. Production still delegates some routes here during migration; do not remove or silently change its behavior.
- `scripts/`: local tools and automated regression tests.
- `deploy/`: example Nginx and PM2 configuration, not the live server configuration.
- `docs-center/`: user-facing documentation; `docs/`: engineering records.
- `dist/`, `docs-dist/` and `node_modules/`: generated output; do not commit.

## Change boundaries

Keep routing and request validation separate from business rules and SQL. Prefer existing helpers before adding a new abstraction. Make normal production reads and writes through repositories; reserve whole-database snapshots for explicit bootstrap, export and restore operations. Keep SQLite transactions synchronous and short; never await network or password hashing while holding a write transaction.

Preserve anonymous evaluation boundaries. Do not log passwords, authorization headers, cookies, complete invite codes, complete timed links or individual score values. Treat full backups as sensitive. Statistical exports must use an explicit allowlist and must not include task-to-participant mappings or stable individual score identifiers.

Use explicit request/response types in TypeScript and `<script setup lang="ts">` in Vue. Use two-space indentation, PascalCase component names and descriptive helper names. Add regression tests for behavior changes before refactoring unrelated code.

## Validation

Run the applicable commands from the repository root:

- `npm ci`
- `npm run check:functions`
- `npm run test:api`
- `npm run test:server`
- `npm run test:golden`
- `npm run test:r2:http-concurrency`
- `npm run test:r2:repository-concurrency`
- `npm run test:r2:queue-removal`
- `npm run test:r2:domain-closeout`
- `npm run check:snapshot-usage -- --expect-clean`
- `npm run build`
- `npm run docs:validate` and `npm run docs:build`

Run new targeted regression tests as well. A successful syntax check is not a runtime test. A previous commit's successful CI is not evidence for a new commit. Record exactly which checks ran and which could not run, including browser and deployment checks.

## Git, releases and deployment

Work in a dedicated branch, use focused commits, and open a pull request against the current `main`. Include the source baseline, behavior changes, validation results and rollback implications. Do not rewrite other contributors' work or force-push shared branches.

The project owner deploys production. Repository changes do not authorize server access, production data changes, secret rotation or deployment. Do not create automatic deployment workflows. Preserve Schema 4 unless a separate reviewed migration and restoration plan explicitly changes it. Never open a database created by a newer schema version with an older application.

Before release, verify a backup and restore using synthetic data, retain the prior application release and provide a deployment checklist. Do not label a release deployment-ready while a required validation is failing or unverified.
