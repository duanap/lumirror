# Backend R2 boundaries

This directory is the staged boundary for Backend Architecture R2. The current
production entrypoint remains `edge-functions/api/[[default]].js` behind the
Node adapter until a domain has passed its repository migration gate.

The boundaries are intentionally explicit:

- `app/` owns application composition and lifecycle.
- `domain/` owns business behavior and must not depend on HTTP or Vue.
- `repositories/contracts/` defines business-oriented repository operations.
- `repositories/sqlite/` contains the direct SQLite implementations.
- `security/` owns authentication, authorization and redaction helpers.
- `http/` owns transport adapters, request IDs and response mapping.

During the staged migration, no normal route may call a whole-database snapshot
save through a new repository interface. Snapshot import/export remains a
maintenance compatibility path until all normal mutations have migrated.
