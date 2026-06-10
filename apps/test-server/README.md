# Test Server for GraphQL Analytics

A sample Apollo Server with the GraphQL Analytics SDK integrated for end-to-end testing.

## Quick Start

### 1. Install dependencies
```bash
cd apps/test-server
npm install
```

### 2. Start the test server (requires collector running)
```bash
npm run dev
# or production build: npm run build && npm start
```

Should output:
```
✓ Test server ready at http://localhost:4000
✓ OpenTelemetry enabled: sending traces/metrics to http://localhost:4318
```

### 3. In another terminal, fire sample queries
```bash
cd apps/test-server
npm run test:queries
```

This sends 15 GraphQL queries (5 different query types × 3 rounds) to generate analytics events.

### 4. Watch the magic happen

- **Collector metrics**: `curl http://localhost:9001`
  - Shows `events_received`, `events_dropped`, `flush_errors`

- **Dashboard**: http://localhost:3000
  - Wait ~60 seconds for aggregation
  - Check **Overview** tab for top fields & slowest resolvers
  - Check **Fields** tab for heatmap

## Schema

Sample schema with realistic resolver delays:

```graphql
type Query {
  user(id: ID!): User          # 10ms delay
  users: [User!]!              # 5ms delay
  post(id: ID!): Post          # 15ms delay
  posts: [Post!]!              # 8ms delay
}

type User {
  id: ID!
  name: String!
  email: String!
  posts: [Post!]!              # 12ms delay
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!                # 8ms delay
}
```

## Configuration

Environment variables:

```bash
PORT=4000                      # GraphQL server port
GRAPHQL_ANALYTICS_COLLECTOR_URL=http://localhost:4318  # OTLP HTTP endpoint
GRAPHQL_ANALYTICS_METRICS_INTERVAL=30000               # Metrics export interval (ms)
GRAPHQL_ANALYTICS_ENABLED=true                         # Enable/disable telemetry export
SERVER_HOST=localhost          # For test:queries
SERVER_PORT=4000               # For test:queries
```

Example:
```bash
GRAPHQL_ANALYTICS_COLLECTOR_URL=http://192.168.1.100:4318 npm run dev
```

## Fixture Data

Test queries use hard-coded IDs and sample data. No database needed.

## Troubleshooting

**Server won't start**
- Check collector is running: `docker compose logs collector`
- Verify port 4000 is free: `netstat -tln | grep 4000`

**Queries fail**
- Ensure test server is running: `npm run dev` in one terminal
- Then run: `npm run test:queries` in another

**No data in dashboard**
- Wait 60+ seconds after firing queries (aggregation interval)
- Check metrics: `curl http://localhost:9001`
- Check collector logs: `docker compose logs collector --tail 20`

## Files

- `src/server.ts` — Apollo Server with SDK plugin + sample schema + resolvers
- `src/test-queries.ts` — Query runner that auto-fires traffic
- `package.json` — Dependencies & npm scripts
- `tsconfig.json` — TypeScript config

