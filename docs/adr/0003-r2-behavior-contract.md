# Freeze the R2 behavior contract before route migration

Backend Architecture R2 must preserve the existing business behavior while
storage and transport boundaries change. The golden gate is
`npm run test:golden`, which runs the API and relational-server smoke suites on
independent temporary data and covers:

- score calculation and `excludeSelf`;
- department and team evaluation scope;
- team-as-target evaluation;
- archive and unarchive behavior;
- timed-link progress and expiry;
- employee and team trends;
- backend permission boundaries; and
- historical SQLite schema migration, restart persistence, atomic writes and
  concurrent scoring.

R2 migration work must keep this gate passing. A failing behavior contract is a
stop condition; the old route and snapshot path remain in place until the
affected domain has a verified replacement.
