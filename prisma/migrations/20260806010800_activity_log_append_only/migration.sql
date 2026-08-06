-- The activity log is the audit trail. The brief requires that normal
-- application operations never edit or delete an entry, so this is enforced by
-- the database rather than by convention: even a mistaken query cannot rewrite
-- history. Application code has no update or delete path for this table.

CREATE TRIGGER activity_log_no_update
BEFORE UPDATE ON "ActivityLog"
BEGIN
  SELECT RAISE(ABORT, 'ActivityLog is append-only: rows cannot be updated');
END;

CREATE TRIGGER activity_log_no_delete
BEFORE DELETE ON "ActivityLog"
BEGIN
  SELECT RAISE(ABORT, 'ActivityLog is append-only: rows cannot be deleted');
END;
