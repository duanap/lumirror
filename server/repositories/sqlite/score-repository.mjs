function repositoryError(message, code = 'TASK_ALREADY_SUBMITTED') {
  const error = new Error(message)
  error.status = 409
  error.code = code
  return error
}

const json = (value) => JSON.stringify(value ?? null)

export class SqliteScoreRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteScoreRepository requires relational storage')
    this.database = storage.database
  }

  create(input) {
    return this.submitAtomic(input)
  }

  submitAtomic({ evaluationId, verifyId, taskId, score, task, verify, timedInvite }) {
    const updatedAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const taskRow = this.database.prepare('SELECT status, evaluation_id, verification_code_id, payload_json FROM evaluation_tasks WHERE id = ?').get(taskId)
      if (!taskRow || taskRow.evaluation_id !== evaluationId || taskRow.verification_code_id !== verifyId) throw repositoryError('评价任务不存在', 'TASK_NOT_FOUND')
      if (taskRow.status === 'submitted') throw repositoryError('该评价对象已评价，不能重复提交')
      const existingScore = this.database.prepare('SELECT 1 FROM scores WHERE task_id = ?').get(taskId)
      if (existingScore) throw repositoryError('该评价对象已评价，不能重复提交')

      const nextOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM scores').get().value)
      const scorePayload = { ...score }
      delete scorePayload.values
      this.database.prepare(
        'INSERT INTO scores (id, evaluation_id, task_id, target_type, target_id, total, created_at, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(score.id, score.evaluationCodeId, score.taskId, score.targetType, score.targetId, Number(score.total), score.createdAt, json(scorePayload), nextOrder)

      const insertValue = this.database.prepare('INSERT INTO score_values (score_id, rule_id, value, list_order) VALUES (?, ?, ?, ?)')
      for (const [index, [ruleId, value]] of Object.entries(score.values || {}).entries()) insertValue.run(score.id, ruleId, Number(value), index)

      const taskPayload = { ...JSON.parse(taskRow.payload_json || '{}'), ...task, status: 'submitted' }
      this.database.prepare('UPDATE evaluation_tasks SET status = ?, payload_json = ? WHERE id = ? AND status = ?')
        .run('submitted', json(taskPayload), taskId, 'pending')

      const verifyRow = this.database.prepare('SELECT status, payload_json FROM verification_codes WHERE id = ? AND evaluation_id = ?').get(verifyId, evaluationId)
      if (!verifyRow) throw repositoryError('邀请码不存在', 'VERIFY_CODE_NOT_FOUND')
      const progress = this.database.prepare('SELECT COUNT(*) AS expected, SUM(CASE WHEN status = \'submitted\' THEN 1 ELSE 0 END) AS submitted FROM evaluation_tasks WHERE verification_code_id = ?').get(verifyId)
      const expected = Number(progress.expected || 0)
      const submitted = Number(progress.submitted || 0)
      const remaining = Math.max(0, expected - submitted)
      const verifyPayload = { ...JSON.parse(verifyRow.payload_json || '{}'), ...verify, expected, submitted, remaining }
      if (expected > 0 && remaining === 0) {
        verifyPayload.status = 'completed'
        verifyPayload.completedAt ||= updatedAt
      } else {
        verifyPayload.status = verifyPayload.firstUsedAt ? 'in_progress' : 'unused'
        verifyPayload.completedAt = null
      }
      this.database.prepare('UPDATE verification_codes SET status = ?, payload_json = ? WHERE id = ?').run(verifyPayload.status, json(verifyPayload), verifyId)

      if (timedInvite) {
        const inviteRow = this.database.prepare('SELECT payload_json FROM timed_invites WHERE id = ? AND verification_code_id = ?').get(timedInvite.id, verifyId)
        if (inviteRow) {
          const invitePayload = { ...JSON.parse(inviteRow.payload_json || '{}'), ...timedInvite }
          this.database.prepare('UPDATE timed_invites SET status = ?, expires_at = ?, payload_json = ? WHERE id = ?')
            .run(invitePayload.status, invitePayload.expiresAt || null, json(invitePayload), timedInvite.id)
        }
      }
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(updatedAt)
      this.database.exec('COMMIT')
      return { expected, submitted, remaining }
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    }
  }
}
