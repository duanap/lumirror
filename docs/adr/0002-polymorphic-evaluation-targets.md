# Use typed polymorphic evaluation targets

Evaluation activities choose exactly one target type, employee or team, and tasks and scores persist that type together with the target ID. The relational target columns intentionally do not use a direct foreign key because SQLite cannot express one foreign key that conditionally references either employees or teams; application validation preserves target integrity while allowing member and team evaluation to share the same task and score workflow.

## Consequences

Existing employee targets migrate as `employee` without changing their IDs or results. A team score describes the selected team itself and is never inferred by averaging employee scores.
