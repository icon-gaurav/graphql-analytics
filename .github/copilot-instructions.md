# GitHub Copilot Prompt — GraphQL Analytics Tool

> Paste this into Copilot Chat (or use as a `.github/copilot-instructions.md` file) to give Copilot full project context before generating any code.

---

## Project overview

You are helping build **GraphQL Analytics** — a lightweight, self-hostable, open source analytics tool for non-federated GraphQL APIs. Think "Plausible Analytics, but for GraphQL."

The goal is radical simplicity: one `docker-compose up` command, a 3-line SDK integration, and a dashboard showing field-level usage, resolver latency, and unused fields. No Kafka, no Kubernetes, no federation required.

**Positioning:** simpler alternative to Apollo GraphOS and GraphQL Hive for small teams and indie developers running Apollo Server, GraphQL Yoga, or Pothos on a monolithic backend.

---

## Architecture

Three services, all in one `docker-compose.yml`:

```
┌─────────────────────────┐
│   User's GraphQL server │
│   SDK plugin (TS/JS)    │  ← in-memory ring buffer, async flush
└────────────┬────────────┘
             │ UDP (fire-and-forget, protobuf payload)
             ▼
┌─────────────────────────┐
│   Collector service     │  ← Go, stateless, fast
│   intake → aggregate    │
│   → batch write to DB   │
└────────────┬────────────┘
             │ SQL writes (separate write user)
             ▼
┌─────────────────────────┐
│   TimescaleDB           │  ← PostgreSQL + timescaledb extension
│   (hypertables)         │
└────────────┬────────────┘
             │ SQL reads (read-only user)
             ▼
┌─────────────────────────┐
│   Displayer service     │  ← Next.js + tRPC, stateless
│   API + Dashboard UI    │
└─────────────────────────┘
```

**Critical constraint:** The SDK must never block the GraphQL response path. If the collector is unreachable, events are silently dropped. No retries, no queuing, no backpressure.

---

## Monorepo structure

```
/
├── packages/
│   ├── sdk/                  # TypeScript SDK (npm package)
│   │   ├── src/
│   │   │   ├── plugin.ts     # Apollo Server plugin entry
│   │   │   ├── yoga.ts       # GraphQL Yoga middleware entry
│   │   │   ├── buffer.ts     # In-memory ring buffer
│   │   │   ├── transport.ts  # UDP sender (fire-and-forget)
│   │   │   ├── schema.ts     # Payload type definitions
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── collector/            # Go service
│       ├── cmd/collector/
│       │   └── main.go
│       ├── internal/
│       │   ├── intake/       # UDP listener
│       │   ├── aggregator/   # 1-min bucket aggregation
│       │   ├── writer/       # TimescaleDB batch writer
│       │   └── proto/        # Protobuf definitions
│       ├── go.mod
│       └── Dockerfile
│
├── apps/
│   └── displayer/            # Next.js app
│       ├── src/
│       │   ├── server/
│       │   │   ├── routers/  # tRPC routers
│       │   │   └── db.ts     # DB client (read-only)
│       │   ├── app/          # Next.js App Router pages
│       │   │   ├── page.tsx              # Overview dashboard
│       │   │   ├── fields/page.tsx       # Field usage heatmap
│       │   │   ├── operations/page.tsx   # Latency breakdowns
│       │   │   └── deprecations/page.tsx # Unused field detector
│       │   └── components/
│       ├── package.json
│       └── Dockerfile
│
├── docker-compose.yml
├── docker-compose.dev.yml
└── README.md
```

---

## SDK — detailed spec (`packages/sdk`)

### Ring buffer (`buffer.ts`)

```typescript
// Circular buffer, fixed size (default 1000 events)
// When full, drop oldest event (never block)
// Flush interval: every 2 seconds OR when 100 events queued (whichever first)
// Flush is async — must not await in the GraphQL execution path
```

### UDP transport (`transport.ts`)

```typescript
// Use Node.js dgram module (UDP4)
// Serialize payload with protobuf (use protobufjs lite)
// Max UDP packet: 65507 bytes — batch multiple events per packet
// On send error: silently swallow, increment a local drop counter
// Expose: getDropCount() for debugging
```

### Payload schema (`schema.ts`)

```typescript
interface OperationEvent {
  operationName: string | null
  operationType: 'query' | 'mutation' | 'subscription'
  fields: FieldUsage[]        // all fields resolved in this operation
  durationMs: number          // total operation duration
  resolverTimings: ResolverTiming[]
  clientName?: string         // from x-graphql-client-name header
  timestamp: number           // Unix ms
  hasErrors: boolean
}

interface FieldUsage {
  typeName: string            // e.g. "User"
  fieldName: string           // e.g. "email"
}

interface ResolverTiming {
  path: string                // e.g. "user.posts.title"
  durationMs: number
}
```

### Apollo Server plugin (`plugin.ts`)

```typescript
// Implement ApolloServerPlugin interface
// On requestDidStart: record start time
// On executionDidStart > willResolveField: capture field path + start time
// On willSendResponse: calculate total duration, collect all field usages, push to ring buffer
// Must handle errors gracefully — plugin crash must not affect the server
```

### GraphQL Yoga middleware (`yoga.ts`)

```typescript
// Use useOnExecute hook from @envelop/core
// Same data capture as Apollo plugin
// Export as: useGraphQLAnalytics({ collectorHost, collectorPort })
```

### Usage example (what the README should show)

```typescript
// Apollo Server
import { GraphQLAnalyticsPlugin } from '@graphql-analytics/sdk'

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
    GraphQLAnalyticsPlugin({ host: 'localhost', port: 9000 })
  ]
})
```

---

## Collector — detailed spec (`packages/collector`)

### UDP intake (`internal/intake`)

```go
// Listen on UDP port 9000 (configurable via COLLECTOR_PORT env)
// Parse protobuf payload
// Push decoded OperationEvent onto a buffered Go channel (size: 10,000)
// If channel is full: drop event, increment dropped_events counter
// Expose /metrics endpoint (Prometheus format) with: events_received, events_dropped, flush_errors
```

### Aggregator (`internal/aggregator`)

```go
// Read from intake channel
// Aggregate into 1-minute time buckets keyed by: (operation_name, field_path, minute_timestamp)
// Track per bucket: call_count, error_count, sum_duration_ms, p50/p95/p99 approx (use t-digest)
// Flush trigger: every 60 seconds via time.Ticker
// On flush: send batch to writer, reset buckets
```

### Writer (`internal/writer`)

```go
// Receive aggregated batches from aggregator
// Insert into TimescaleDB using pgx/v5 (not database/sql)
// Use COPY protocol for bulk inserts (fastest path)
// On DB error: retry 3x with exponential backoff, then log and drop
// Connection pool: max 5 connections (write user only)
```

### Environment variables

```
COLLECTOR_PORT=9000
DB_WRITE_URL=postgres://collector:password@timescaledb:5432/graphql_analytics
FLUSH_INTERVAL_SECONDS=60
BUCKET_CHANNEL_SIZE=10000
```

---

## TimescaleDB schema

```sql
-- Run once on init (use golang-migrate for migrations)

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Raw operation log (keep 7 days, then drop)
CREATE TABLE operations (
  time           TIMESTAMPTZ NOT NULL,
  operation_name TEXT,
  operation_type TEXT,
  duration_ms    FLOAT,
  has_errors     BOOLEAN,
  client_name    TEXT
);
SELECT create_hypertable('operations', 'time');
SELECT add_retention_policy('operations', INTERVAL '7 days');

-- Field usage (aggregated per minute)
CREATE TABLE field_usage (
  time           TIMESTAMPTZ NOT NULL,
  type_name      TEXT NOT NULL,
  field_name     TEXT NOT NULL,
  call_count     BIGINT,
  error_count    BIGINT
);
SELECT create_hypertable('field_usage', 'time');
SELECT add_retention_policy('field_usage', INTERVAL '90 days');

-- Resolver timings (aggregated per minute)
CREATE TABLE resolver_timings (
  time           TIMESTAMPTZ NOT NULL,
  field_path     TEXT NOT NULL,
  p50_ms         FLOAT,
  p95_ms         FLOAT,
  p99_ms         FLOAT,
  call_count     BIGINT
);
SELECT create_hypertable('resolver_timings', 'time');
SELECT add_retention_policy('resolver_timings', INTERVAL '90 days');

-- Continuous aggregate: hourly field usage rollup
CREATE MATERIALIZED VIEW field_usage_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS hour,
       type_name, field_name,
       SUM(call_count) AS call_count
FROM field_usage
GROUP BY hour, type_name, field_name;
```

---

## Displayer — detailed spec (`apps/displayer`)

### tRPC routers (`src/server/routers`)

```typescript
// All queries use read-only DB connection (DB_READ_URL env)
// statement_timeout: 5000ms on every query (protect against runaway queries)

// router: fields
//   - fieldUsage({ from, to, limit }): top N fields by call count in time range
//   - unusedFields({ daysSince }): fields not seen in last N days (cross-ref schema)
//   - fieldTrend({ typeName, fieldName, from, to }): hourly call count over time

// router: operations
//   - topOperations({ from, to }): operations ranked by call count + error rate
//   - latencyBreakdown({ operationName, from, to }): p50/p95/p99 per resolver path
//   - errorRate({ from, to }): error % over time

// router: overview
//   - summary(): total ops last 24h, error rate, top 5 slowest resolvers, top 5 fields
```

### Dashboard pages

```
/ (overview)
  - 24h sparklines: request volume, error rate
  - Top 5 slowest resolvers (p95)
  - Top 5 most-called fields
  - Last seen: timestamp of most recent event

/fields
  - Heatmap table: rows = type, cols = field, cell color = call frequency
  - Filter by type name
  - "Unused" tab: fields with zero calls in last 30 days

/operations
  - Table: operation name | type | calls | error% | p50 | p95 | p99
  - Click row → resolver waterfall breakdown

/deprecations
  - List of deprecated fields (parsed from schema SDL)
  - For each: last seen date, call count last 30 days, "safe to remove" badge if 0 calls
```

### Schema deprecation detection

```typescript
// On displayer startup: read SCHEMA_SDL_PATH env (path to .graphql file)
// Parse with graphql-js: buildSchema(), then walk all types
// Extract all fields with @deprecated directive
// Store in memory, refresh every 5 minutes
// Displayer /deprecations page cross-references DB usage data against this list
```

---

## docker-compose.yml

```yaml
version: '3.9'
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: graphql_analytics
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
    volumes:
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
      - timescale_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  collector:
    build: ./packages/collector
    environment:
      COLLECTOR_PORT: 9000
      DB_WRITE_URL: postgres://collector_user:password@timescaledb:5432/graphql_analytics
    ports:
      - "9000:9000/udp"
      - "9001:9001"   # metrics endpoint
    depends_on:
      - timescaledb

  displayer:
    build: ./apps/displayer
    environment:
      DB_READ_URL: postgres://displayer_user:password@timescaledb:5432/graphql_analytics
      SCHEMA_SDL_PATH: /schema/schema.graphql
    ports:
      - "3000:3000"
    volumes:
      - ./schema.graphql:/schema/schema.graphql
    depends_on:
      - timescaledb

volumes:
  timescale_data:
```

---

## Coding conventions

- **SDK (TypeScript):** strict mode, no `any`, ESM output, zero runtime dependencies except `protobufjs` and peer deps (`graphql`, framework SDK). Target Node 18+.
- **Collector (Go):** Go 1.22+, standard library + `pgx/v5` + `protobuf` + `go-tddigest`. No ORMs. Errors always handled explicitly — no blank `_` ignores on DB calls.
- **Displayer (TypeScript/Next.js):** Next.js 14 App Router, tRPC v11, `postgres` package (not Prisma), Tailwind CSS, Recharts for charts.
- **Error handling:** SDK swallows all errors silently (never crash the user's server). Collector logs errors but never panics. Displayer surfaces errors in the UI.
- **Tests:** SDK unit tests with Vitest. Collector tests with `go test`. Integration test: spin up docker-compose, fire 100 events via SDK, assert they appear in displayer API within 90 seconds.

---

## What NOT to build (MVP scope)

- No schema registry or schema diffing
- No federation / supergraph support
- No SSO or team management
- No alerts or webhooks (post-MVP)
- No breaking change detection (post-MVP)
- No GraphQL subscriptions tracking (post-MVP)

---

## Suggested first tasks for Copilot

Start here, in this order:

1. `packages/sdk/src/buffer.ts` — implement the ring buffer with flush trigger
2. `packages/sdk/src/transport.ts` — UDP sender with silent drop on error
3. `packages/sdk/src/plugin.ts` — Apollo Server plugin using the buffer + transport
4. `packages/collector/internal/intake/udp.go` — UDP listener → channel
5. `packages/collector/internal/aggregator/aggregator.go` — bucket aggregation + flush
6. `packages/collector/internal/writer/writer.go` — pgx COPY insert to TimescaleDB
7. `apps/displayer/src/server/routers/fields.ts` — field usage tRPC router
8. `apps/displayer/src/app/fields/page.tsx` — field heatmap UI

---

*This prompt encodes all architectural decisions made. Do not deviate from the collector/displayer separation, the fire-and-forget UDP transport, or the TimescaleDB hypertable schema without explicit discussion.*