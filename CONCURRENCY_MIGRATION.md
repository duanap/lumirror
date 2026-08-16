# Concurrent Scoring Migration

## EdgeOne KV: Confirmed Failure

The current storage model reads the full database from `employee_review_db_v1`, mutates an in-memory copy, and overwrites the same KV key. Two score submissions can therefore read the same snapshot and both return success while the later write discards the earlier score.

Run the deterministic reproduction:

```bash
npm run repro:concurrency
```

For the EdgeOne KV adapter, the expected result is a non-zero exit with `1 !== 2`: two API submissions succeeded, but only one review remained visible through the admin results API. This command is intentionally separate from the passing validation suite.

## Direct Server: Resolved

Version 1.3.0 stores business entities in relational SQLite tables. `scores.task_id` is unique, score dimensions use `score_values`, all snapshot changes commit in one SQLite transaction, and the single PM2 process serializes HTTP writes. `npm run test:server` verifies two concurrent score submissions become two persisted score rows and survive restart.

## Required Consistency Contract

The scoring store must provide all of the following:

- A unique constraint or equivalent atomic create operation keyed by `taskId`.
- One transaction that creates the score and marks its task submitted.
- Immediate reads of the committed score for progress and result calculations.
- Idempotent retry behavior: a repeated submission for one task cannot create a second score.
- Durable audit fields for the activity, task, anonymous evaluator hash, score values, total, and submission time.

This remaining migration boundary applies only if EdgeOne Functions are used again. The direct server already uses the transactional SQLite adapter.

## Implementation Boundary

Introduce a scoring repository with behavior-oriented operations rather than exposing database tables to routes:

```text
getPendingTask(verifyCodeId)
submitScoreOnce(taskId, evaluationCodeId, score)
getEvaluationProgress(verifyCodeId)
listEvaluationResults(evaluationCodeId)
```

`submitScoreOnce` owns the transaction and duplicate protection. Public and admin routes continue to enforce the existing session, RBAC, score-range, self-exclusion, and response contracts.

## Safe Delivery Sequence

1. Choose a transactional database available from EdgeOne Functions and define the minimum score/task schema.
2. Add the repository adapter behind a disabled storage mode; keep KV as the default.
3. Turn `npm run repro:concurrency` green against the new adapter, then add duplicate-submit and rollback tests.
4. Add an importer that reads a full sensitive backup and reports record counts and relationship errors without writing by default.
5. Take a recoverable production backup and enable maintenance mode for scoring writes.
6. Import tasks and scores, compare counts, deterministic IDs, and sampled result totals.
7. Switch the storage mode, run health and concurrent scoring checks, then reopen writes.
8. Retain the original KV snapshot and a tested reverse export until the rollback window closes.

Do not dual-write KV and the transactional store as the correctness mechanism: a Function failure between two independent writes can make the stores disagree.

## Acceptance Criteria

- `npm run repro:concurrency` passes with both successful submissions persisted.
- Concurrent submissions for the same task produce one score and one conflict/idempotent response.
- Progress and admin result counts agree immediately after successful submissions.
- Existing `npm run test:api`, `npm run check:functions`, and `npm run build` remain green.
- Import dry-run, final import, and reverse export report matching task and score counts.
- A rollback rehearsal succeeds before production writes are reopened.
