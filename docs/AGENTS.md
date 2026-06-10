# AGENTS.md — GraphQL Analytics

> Guidance for AI coding agents working on this monorepo. For full context, see `.github/copilot-instructions.md`.

## Core Architecture

**Three-service design** (single `docker-compose.yml` deployment):
- **SDKs** (`packages/sdk-core`, `packages/sdk-apollo`, `packages/sdk-express`, `packages/sdk-fastify`): TypeScript telemetry SDKs that export via OTLP HTTP (never blocks GraphQL execution)
- **Collector** (`apps/collector`): Go service — receives OTLP traces on HTTP 4318, aggregates events into 1-minute buckets, batch-writes to TimescaleDB
- **Dashboard** (`apps/dashboard`): Next.js app — read-only queries on aggregated data, exposes dashboard + tRPC API

**Critical constraint:** SDK must never block the user's GraphQL response path. If collector is unreachable, events silently drop.

## Key Workflows

### Build & Test
```bash
# Root: install + build all packages
npm install
npm run build

# SDK tests: unit tests with Vitest
cd packages/sdk-core && npm run test

# Collector tests: Go tests with in-memory channel
cd apps/collector && go test ./...

# Integration test: spin up services, fire events, verify dashboard sees them within 90s
docker-compose up && <run integration test>
```

### Development
- **SDK changes** affect both Apollo and Yoga integrations — test both (`plugin.ts` + `yoga.ts`)
- **Collector changes** require Go 1.22+, test with `go test ./internal/...`
- **Displayer changes** use Next.js 14 App Router + tRPC v11 — hot reload works on port 3000

### Database Migrations
TimescaleDB schema lives in `schemas/init.sql` (run once on container init). No ORM — use raw SQL in collector's `internal/writer/writer.go`. Changes require new migration file + update docker-compose volume mount.

## Critical Patterns

### SDK Ring Buffer (fire-and-forget resilience)
`packages/sdk-core/src/buffer.ts`: Fixed-size circular buffer (default 1000 events). When full, drop oldest. Flush every 2 seconds OR when 100 events queued (async, never `await` in GraphQL path).

```typescript
// Never throw or block here
buffer.push(event)  // drops oldest if full
// flush() runs async, swallows errors
```

### Collector Aggregation (1-minute buckets)
`apps/collector/internal/aggregator/`: Group events by `(operation_name, field_path, minute_timestamp)`. Calculate: call_count, error_count, p50/p95/p99 duration using t-digest.

### Displayer Schema Deprecation
`apps/dashboard/src/server/`: Load GraphQL schema SDL at startup (env `SCHEMA_SDL_PATH`), parse with `graphql-js`, extract `@deprecated` directives. Refresh in-memory every 5 minutes. Cross-reference with DB usage on `/deprecations` page.

## Data Flow (Events → Dashboard)

1. User's GraphQL server → Apollo/Yoga plugin captures field paths + timings
2. Plugin → ring buffer (in-memory, ring can have backlog)
3. SDK OTel exporter → OTLP HTTP batch to collector (best-effort async export)
4. Collector intake → buffered Go channel (internal/10,000 cap)
5. Aggregator goroutine → 1-min buckets (with p50/p95/p99)
6. Writer → COPY protocol batch insert to TimescaleDB
7. Displayer tRPC routers query read-only replica → Next.js components

End-to-end: Event → Dashboard is ~65 seconds (60s flush + processing).

## File Must-Knows

| File | Responsibility | Note |
|------|---|---|
| `packages/sdk-core/src/schema.ts` | Protobuf payload definition | Changes here affect collector proto parsing |
| `packages/sdk-core/src/buffer.ts` | Ring buffer + flush logic | Never blocks, drops on overflow |
| `packages/sdk-apollo/src/index.ts` | Apollo SDK entrypoint | Re-exports Apollo integration |
| `apps/collector/internal/aggregator/aggregator.go` | Bucket aggregation | T-digest for percentiles |
| `apps/collector/internal/writer/writer.go` | DB writes | COPY protocol, pgx/v5, 3x retry with backoff |
| `apps/dashboard/src/server/routers/*.ts` | tRPC endpoints | All queries from read-only DB + 5s timeout |
| `apps/dashboard/src/app/*/page.tsx` | UI pages | Recharts for timeseries, Tailwind CSS |
| `.github/copilot-instructions.md` | Full spec (417 lines) | Refer here for detailed SQL schema, Docker config |

## Common Coding Rules

- **SDK (TypeScript)**: `strict: true`, no `any`, zero runtime deps except `protobufjs` + peer. Target Node 18+.
- **Collector (Go)**: Go 1.22+, stdlib + `pgx/v5`. Never blank-ignore errors on `db.Query()`.
- **Displayer (Next.js)**: App Router, tRPC v11, `postgres` package (not Prisma), `statement_timeout: 5000ms` on all DB queries.
- **Error handling**: SDK swallows all errors silently (never panic user's server). Collector logs but never panics. Displayer surfaces in UI.

## Monorepo Entry Points

- Root `package.json`: runs `tsc` (TS compilation) — no linter/formatter config yet
- `deployments/docker-compose.yml`: single-command local dev + deploy (TimescaleDB + collector + dashboard)
- `tsconfig.json` (root): baseline, each package/app has own (inherits)
- No workspace tool (yarn/pnpm) — uses npm workspaces (npm 7+)

## Unimplemented (Out of Scope)

- Schema registry, federation, SSO, team management
- Alerts, webhooks, breaking change detection, subscriptions tracking

---

**When adding a feature:** Ensure it doesn't block the GraphQL response path, runs in a background goroutine (collector), and fails gracefully.

