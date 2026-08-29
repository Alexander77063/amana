-- An audit event has at most ONE actor: a customer (`actor_user_id`) or a member of Amana staff
-- (`actor_admin_user_id`), never both.
--
-- The constraint lives in the database rather than in the audit service because `audit_log` is
-- append-only (0007_audit_immutable.sql): a row asserting that a customer AND an operator
-- performed one action can never be corrected afterwards, only apologised for. Postgres is the
-- only layer that no caller can route around.
--
-- `<= 1`, not `= 1`, on purpose. Plenty of legitimate events have no actor at all — `actorKind`
-- 'system' (a cron sweep) and 'partner' (an Anchor webhook) are both actorless by nature, and
-- every historical 'ops' row predates attribution. Requiring exactly one would fail validation
-- against rows already in the table, and would be wrong besides. That an ops action names its
-- operator is enforced where operators are, in the service layer.
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_single_actor"
  CHECK (num_nonnulls("actor_user_id", "actor_admin_user_id") <= 1);
