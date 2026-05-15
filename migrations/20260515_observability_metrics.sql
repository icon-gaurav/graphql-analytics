-- GraphQL Analytics observability upgrade
-- Apply this to existing databases before using the new schema/security analytics.

ALTER TABLE operations ADD COLUMN IF NOT EXISTS query_depth INTEGER DEFAULT 0;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS field_count INTEGER DEFAULT 0;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS complexity_score INTEGER DEFAULT 0;

ALTER TABLE resolver_timings ADD COLUMN IF NOT EXISTS operation_name TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_resolver_timings_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolver_timings_unique
  ON resolver_timings (time, operation_name, field_path);

CREATE INDEX IF NOT EXISTS idx_operations_name_time
  ON operations (operation_name, time DESC);

CREATE INDEX IF NOT EXISTS idx_operations_client_time
  ON operations (client_name, time DESC);

