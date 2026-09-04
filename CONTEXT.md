# Lumirror Evaluation

Lumirror manages anonymous employee evaluation activities, their participants, assigned targets, and submitted scores.

## Language

**Review Period**:
A named time window used to group evaluation activities.
_Avoid_: Cycle, season

**Evaluation Activity**:
A scheduled evaluation with one rule set, a participant set, and either a target employee set or a target team set.
_Avoid_: Evaluation code, campaign

**Participant**:
An employee selected to evaluate targets in an evaluation activity.
_Avoid_: Reviewer, user

**Participant Scope**:
The rule that selects eligible participants for one evaluation activity: one team or all active members of one department's active teams. It is independent from the activity's management team and evaluation target scope.
_Avoid_: Evaluation target scope

**Member Tag**:
A reusable descriptive label assigned to one or more employees. A member tag never grants, revokes, or implies an account permission.
_Avoid_: Role, permission

**Evaluation Target**:
An employee or team selected to receive evaluations in one evaluation activity. Every activity uses exactly one target type.
_Avoid_: Reviewee, subject

**Target Employee**:
An employee used as an evaluation target in a member-target activity.
_Avoid_: Reviewee

**Employee Target Scope**:
The rule that selects target employees for a member-target activity: one team, one department's active teams, or an explicit member list. It is independent from the participant team.
_Avoid_: Department evaluation

**Target Team**:
A team used as an evaluation target in a team-target activity. Its result represents the team as a whole, not an average calculated from its members' separate results.
_Avoid_: Team member set

**Verification Code**:
A single participant's credential for entering an evaluation activity and completing assigned tasks.
_Avoid_: Invitation code, password

**Evaluation Task**:
One participant's assignment to evaluate one evaluation target in one evaluation activity.
_Avoid_: Review, score

**Score Submission**:
The anonymous dimension values and computed total recorded for one completed evaluation task.
_Avoid_: Result, rating

**Score Dimension**:
A configurable measure collected for every target in one evaluation activity.
_Avoid_: Field, metric

**Contribution Direction**:
Whether a score dimension adds to or subtracts from the weighted total.
_Avoid_: Calculation type, positive/negative score

**Timed Invite**:
A single-use entry link whose five-minute lifetime starts on first opening.
_Avoid_: Temporary code, expiring activity

**Timed Invite Progress**:
The completed, total, and remaining evaluation tasks associated with one timed invite.
_Avoid_: Link usage count

**Evaluation Archive**:
A read-only administrative state for an ended evaluation activity. Archiving hides an activity from the main list without deleting its rules, tasks, invites, scores, or audit history.
_Avoid_: Deletion, end status

**Score Trend Point**:
The average total score for one evaluation target in one evaluation activity. Team trend points use only team-target activities and never average employee-target scores.
_Avoid_: Team average
