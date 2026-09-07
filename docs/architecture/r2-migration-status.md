# Backend R2 migration status

This checklist records the Direct SQLite migration on `codex/backend-r2-domain-crud`.
The Node production path has completed the Domain CRUD migration, while the legacy
EdgeOne handler remains available as a compatibility adapter. `requestQueue` is
still intentionally kept and must only be removed in a separate, dedicated PR.

## Stage status

- [x] D1 Evaluation + Period
- [x] D2 Invite + Timed Invite + Admin Tasks
- [x] D3 Employee + Member Tags
- [x] D4 Department + Team
- [x] D5 User + Account
- [x] D6 Audit
- [x] D7 Import / Export maintenance boundary

All D1-D7 stages are `PASS` for the Node Direct SQLite production path.

## Scoring chain

- [x] `current-task` reads verification, pending task, target and rules through SQL.
- [x] `submit-score` writes score, score values, task state, verification progress and audit state transactionally.
- [x] task progress uses Direct SQL for public and admin reads.
- [x] verification progress uses Direct SQL and transactional updates.
- [x] timed invite entry/progress uses Direct SQL, including expiration state updates.
- [x] results use SQL aggregation by target.
- [x] trends and trend options use SQL queries for employee/team targets.

The `test:r2:concurrency` Gate covers different-task writes, duplicate-task writes,
concurrent results/trends reads and post-submit current-task reads.

## Audit boundary

Direct SQL audit coverage includes scoring, evaluation lifecycle, user/account,
member/tag, settings, batch and maintenance actions. Audit records use the verified
actor where applicable and must not contain passwords, authorization headers,
cookies, sessions, tokens, full invite/link secrets, evaluator identity or personal
score contents.

## Snapshot boundary

`npm run check:snapshot-usage -- --expect-clean` is now enforced in CI.

Current boundary:

- Normal Snapshot Mutation: `NO` (`0` candidates)
- Legacy EdgeOne Snapshot fallback calls: `37` (`KEEP`, explicitly tracked)
- Maintenance Snapshot reads: allowed
- Maintenance bulk Snapshot writes: exactly `1`, limited to maintenance import
- Normal CRUD and scoring paths: Direct SQLite only
- Double write: prohibited

The remaining EdgeOne Snapshot calls are compatibility fallback code and are not
used by the Node normal production mutation path. Their tracked count prevents
silent expansion while EdgeOne remains supported.

## Validation

The Domain CRUD closeout Gate includes:

- `npm audit` — 0 vulnerabilities
- `npm run check:functions`
- `npm run test:api`
- `npm run test:server`
- `npm run test:golden`
- `npm run test:r2:concurrency`
- `npm run test:r2:domain-closeout`
- `npm run check:snapshot-usage -- --expect-clean`
- `npm run build`
- `npm run docs:validate`
- `npm run docs:build`
- SQLite `PRAGMA quick_check` — `ok`
- SQLite `PRAGMA foreign_key_check` — no violations

## Guardrails

- Schema version: 4
- `PRAGMA foreign_keys`: ON
- `PRAGMA journal_mode`: WAL
- `PRAGMA synchronous`: FULL
- `PRAGMA busy_timeout`: 5000
- Global request queue: KEEP
- PM2: one fork instance
- EdgeOne adapter: KEEP
- Production deploy: NO

## Next stage

After this Domain CRUD PR is merged and `main` CI is green, start a separate
`requestQueue` removal PR from the clean merged baseline. That stage must add
stronger HTTP/SQLite concurrency stress coverage before removing serialization.
It must not change Schema 4, remove EdgeOne, switch PM2 to cluster mode, or deploy
production as part of the same change.
