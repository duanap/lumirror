# Store business entities in relational SQLite tables

Lumirror stores each business entity in a dedicated SQLite table, with join tables for evaluation rules, participants, targets, and score values. The HTTP handler keeps its existing in-memory domain snapshot interface for compatibility, while a deep storage module transactionally assembles and persists that snapshot; this avoids a high-risk route rewrite now and leaves direct SQL repositories as a later optimization.

## Consequences

The database is queryable and constrained by business identity and relationships, and every save is atomic. Writes still replace the relational snapshot inside one transaction, so the PM2 process remains single-instance until route-level repositories replace snapshot writes.
