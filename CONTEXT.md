# Lumirror Evaluation

Lumirror manages anonymous employee evaluation activities, their participants, assigned targets, and submitted scores.

## Language

**Review Period**:
A named time window used to group evaluation activities.
_Avoid_: Cycle, season

**Evaluation Activity**:
A scheduled evaluation with one rule set, a participant set, and a target employee set.
_Avoid_: Evaluation code, campaign

**Participant**:
An employee selected to evaluate targets in an evaluation activity.
_Avoid_: Reviewer, user

**Target Employee**:
An employee selected to receive evaluations in an evaluation activity.
_Avoid_: Reviewee, subject

**Verification Code**:
A single participant's credential for entering an evaluation activity and completing assigned tasks.
_Avoid_: Invitation code, password

**Evaluation Task**:
One participant's assignment to evaluate one target employee in one evaluation activity.
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
