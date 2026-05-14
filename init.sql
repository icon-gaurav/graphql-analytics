-- TimescaleDB schema for GraphQL Analytics

-- Create extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create users with appropriate permissions
DO $$
BEGIN
  -- Create collector user (write-only)
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'collector_user') THEN
    CREATE USER collector_user WITH PASSWORD 'password';
  END IF;

  -- Create displayer user (read-only)
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'displayer_user') THEN
    CREATE USER displayer_user WITH PASSWORD 'password';
  END IF;
END
$$;

-- Raw operation log (keep 7 days, then drop)
CREATE TABLE IF NOT EXISTS operations (
  time           TIMESTAMPTZ NOT NULL,
  operation_name TEXT,
  operation_type TEXT,
  duration_ms    FLOAT,
  has_errors     BOOLEAN,
  client_name    TEXT
);

SELECT create_hypertable('operations', 'time', if_not_exists => TRUE);
SELECT add_retention_policy('operations', INTERVAL '7 days', if_not_exists => TRUE);

-- Field usage (aggregated per minute)
CREATE TABLE IF NOT EXISTS field_usage (
  time           TIMESTAMPTZ NOT NULL,
  type_name      TEXT NOT NULL,
  field_name     TEXT NOT NULL,
  call_count     BIGINT DEFAULT 0,
  error_count    BIGINT DEFAULT 0
);

SELECT create_hypertable('field_usage', 'time', if_not_exists => TRUE);
SELECT add_retention_policy('field_usage', INTERVAL '90 days', if_not_exists => TRUE);

-- Add unique index to handle conflicts
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_usage_unique
  ON field_usage (time, type_name, field_name);

-- Resolver timings (aggregated per minute)
CREATE TABLE IF NOT EXISTS resolver_timings (
  time           TIMESTAMPTZ NOT NULL,
  field_path     TEXT NOT NULL,
  p50_ms         FLOAT,
  p95_ms         FLOAT,
  p99_ms         FLOAT,
  call_count     BIGINT
);

SELECT create_hypertable('resolver_timings', 'time', if_not_exists => TRUE);
SELECT add_retention_policy('resolver_timings', INTERVAL '90 days', if_not_exists => TRUE);

-- Add unique index for resolver timings
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolver_timings_unique
  ON resolver_timings (time, field_path);

-- Continuous aggregate: hourly field usage rollup
CREATE MATERIALIZED VIEW IF NOT EXISTS field_usage_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS hour,
       type_name,
       field_name,
       SUM(call_count) AS call_count,
       SUM(error_count) AS error_count
FROM field_usage
GROUP BY hour, type_name, field_name;

-- Set permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO displayer_user;
GRANT INSERT, UPDATE, SELECT ON operations, field_usage, resolver_timings TO collector_user;
GRANT SELECT ON operations, field_usage, resolver_timings TO displayer_user;

-- Allow displayer to query continuous aggregates
GRANT SELECT ON field_usage_hourly TO displayer_user;

