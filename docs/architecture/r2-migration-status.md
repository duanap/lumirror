# Backend R2 migration status

This checklist records only Direct SQLite work on `codex/backend-r2`. The
legacy EdgeOne handler remains available, and `requestQueue` remains required
while normal Snapshot mutations still exist.

## Scoring chain

- [x] `current-task` reads verification, pending task, target and rules through SQL.
- [x] `submit-score` writes score, score values and task state in one transaction.
- [~] task progress: public current/remaining paths use SQL; admin task listing is still Snapshot-backed.
- [~] verification progress: score and public progress paths use SQL; admin verification listing is still Snapshot-backed.
- [~] timed invite progress: direct timed entry and public progress use SQL; admin timed-invite listing is still Snapshot-backed.
- [x] results use SQL aggregation by target.
- [x] trends and trend options use SQL queries for employee/team targets.

The scoring chain is `PARTIAL` until the remaining admin task, verification and
timed-invite reads are migrated and the concurrency Gate is complete.

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
