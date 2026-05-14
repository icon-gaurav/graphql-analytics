# GraphQL Analytics

> Lightweight, self-hostable analytics tool for GraphQL APIs. Think "Plausible Analytics, but for GraphQL."

## 🎯 Features

- **Field-level usage tracking** — See which fields are actually used in your schema
- **Resolver latency breakdown** — Monitor p50, p95, p99 latency per resolver
- **Error rate monitoring** — Track errors over time
- **Unused field detection** — Identify deprecated fields that are safe to remove
- **Fire-and-forget SDK** — Never blocks your GraphQL response path
- **Simple integration** — 3 lines of code to add to Apollo Server or GraphQL Yoga

## 🏗️ Architecture

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

## 🚀 Quick Start

### Using Docker Compose

```bash
# Clone the repo and install dependencies
git clone <repo>
cd graphql-analytics
npm install

# Start all services
docker-compose up

# Services will be available at:
# - Dashboard: http://localhost:3000
# - Collector: localhost:9000/udp
# - Metrics: http://localhost:9001/metrics
```

### Integration with Apollo Server

```typescript
import { GraphQLAnalyticsPlugin } from '@graphql-analytics/sdk'

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [
    GraphQLAnalyticsPlugin({
      host: 'localhost', // collector host
      port: 9000,        // collector port
    })
  ]
})

await server.start()
```

### Integration with GraphQL Yoga

```typescript
import { useGraphQLAnalytics } from '@graphql-analytics/sdk'

const yoga = createYoga({
  schema,
  plugins: [
    useGraphQLAnalytics({
      host: 'localhost',
      port: 9000,
    })
  ]
})
```

## 📦 Project Structure

```
graphql-analytics/
├── packages/
│   ├── sdk/              # TypeScript SDK (npm package)
│   │   ├── src/
│   │   │   ├── buffer.ts       # Ring buffer with async flush
│   │   │   ├── transport.ts    # UDP sender (fire-and-forget)
│   │   │   ├── plugin.ts       # Apollo Server plugin
│   │   │   ├── yoga.ts         # GraphQL Yoga middleware
│   │   │   └── schema.ts       # Payload types
│   │   └── package.json
│   │
│   └── collector/       # Go service
│       ├── cmd/collector/
│       ├── internal/
│       │   ├── intake/         # UDP listener
│       │   ├── aggregator/     # 1-min bucket aggregation
│       │   └── writer/         # TimescaleDB writer
│       └── go.mod
│
├── apps/
│   └── displayer/       # Next.js dashboard
│       ├── src/
│       │   ├── server/
│       │   │   ├── routers/    # tRPC endpoints
│       │   │   └── db.ts       # Database client
│       │   └── pages/          # UI pages
│       └── package.json
│
├── docker-compose.yml
├── init.sql              # TimescaleDB schema
└── README.md
```

## 🛠️ Development

### Build everything

```bash
npm run build
```

### Run tests

```bash
npm run test
```

### Development servers (with hot reload)

```bash
npm run dev
```

This will start:
- SDK: TypeScript compilation in watch mode
- Collector: Go service (requires `go run`)
- Displayer: Next.js dev server on port 3000

## 📊 Dashboard Pages

- **Overview** (`/`) — At a glance: ops/24h, error rate, top fields, slowest resolvers
- **Fields** (`/fields`) — Heatmap of all fields + unused detection
- **Operations** (`/operations`) — Operation metrics: latency, call count, errors
- **Deprecations** (`/deprecations`) — Deprecated fields with usage info

## ⚙️ Configuration

### SDK

```typescript
GraphQLAnalyticsPlugin({
  host: 'localhost',              // Collector host
  port: 9000,                     // Collector UDP port
  bufferCapacity: 1000,           // Max events in memory
  bufferFlushIntervalMs: 2000,    // Flush every 2 seconds
  bufferFlushThreshold: 100,      // Flush at 100 events
})
```

### Collector

Environment variables:

```
COLLECTOR_PORT=9000
DB_WRITE_URL=postgres://user:pass@host/dbname
FLUSH_INTERVAL_SECONDS=60
BUCKET_CHANNEL_SIZE=10000
```

### Displayer

Environment variables:

```
DB_READ_URL=postgres://user:pass@host/dbname
SCHEMA_SDL_PATH=/path/to/schema.graphql
NODE_ENV=production
```

## 🔒 Data Retention

- **Raw operations** — 7 days
- **Aggregated field usage** — 90 days
- **Resolver timings** — 90 days
- **Continuous aggregates** — 90 days

## 📈 Performance

- **SDK overhead** — <1ms (fire-and-forget UDP)
- **Collector throughput** — ~100k events/sec per instance
- **Dashboard queries** — <5s (statement timeout)
- **Data freshness** — ~60s (aggregation interval)

## 🚫 Out of Scope (MVP)

- Schema registry / schema diffing
- Federation / supergraph support
- SSO / team management
- Alerts / webhooks
- Breaking change detection
- GraphQL subscriptions tracking

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please see AGENTS.md for developer guidance.

