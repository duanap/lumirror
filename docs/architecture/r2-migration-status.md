# Backend R2 migration status

This checklist records only Direct SQLite work on `codex/backend-r2`. The
legacy EdgeOne handler remains available, and `requestQueue` remains required
while normal Snapshot mutations still exist.

## Scoring chain

- [x] `current-task` reads verification, pending task, target and rules through SQL.
- [x] `submit-score` writes score, score values and task state in one transaction.
- [x] task progress: public and admin task reads use SQL; score submission updates task state transactionally.
- [x] verification progress: public and admin verification reads use SQL; score submission updates progress transactionally.
- [x] timed invite progress: direct timed entry, public progress and admin timed-invite reads use SQL.
- [x] results use SQL aggregation by target.
- [x] trends and trend options use SQL queries for employee/team targets.

The scoring chain is `PASS` for the current Direct SQLite scope. The
`test:r2:concurrency` Gate covers different-task writes, duplicate-task writes,
concurrent results/trends reads and post-submit current-task reads. Mutation
endpoints for generating or repairing tasks/invites remain in the legacy
Snapshot path and are listed under the later Domain CRUD migration.

## Other domains

- [ ] activities
- [ ] invites
- [ ] tasks admin
- [ ] employees
- [ ] member tags
- [ ] departments
- [ ] teams
- [ ] users
- [ ] periods
- [ ] audit
- [ ] import/export

## Guardrails

- Schema version: 4
- `PRAGMA foreign_keys`: ON
- `PRAGMA journal_mode`: WAL
- `PRAGMA synchronous`: FULL
- `PRAGMA busy_timeout`: 5000
- Global request queue: KEEP
- PM2: one fork instance
- EdgeOne adapter: KEEP
