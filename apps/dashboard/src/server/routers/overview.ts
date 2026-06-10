import { publicProcedure, router } from '../trpc';
import { getDB } from '../db';

interface CountRow { count: string }
interface StatRow { total_calls: string; total_errors: string }
interface SlowRow { field_path: string; avg_p99: string }
interface TopFieldRow { type_name: string; field_name: string; total_calls: string }
interface VolumeRow { hour: string; call_count: string }
interface ClientRow { client_name: string | null; call_count: string; error_count: string }
interface LastSeenRow { last_seen_at: Date | null }

interface PingRow { ok: number }

interface FreshnessRow { last_seen_at: Date | null }

const overviewRouter = router({
  health: publicProcedure.query(async () => {
    const checkedAt = new Date();
    const collectorHealthUrl = process.env.COLLECTOR_HEALTH_URL ?? 'http://collector:4318/health';

    let collector = {
      ok: false,
      statusCode: 0,
      message: 'unreachable',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(collectorHealthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      collector = {
        ok: response.ok,
        statusCode: response.status,
        message: response.ok ? 'healthy' : `http_${response.status}`,
      };
    } catch {
      collector = {
        ok: false,
        statusCode: 0,
        message: 'timeout_or_network_error',
      };
    } finally {
      clearTimeout(timeoutId);
    }

    const db = getDB();
    let database = {
      ok: false,
      message: 'unreachable',
    };
    let pipeline = {
      ok: false,
      lastSeenAt: null as Date | null,
      lagSeconds: null as number | null,
      message: 'unknown',
    };

    try {
      const ping = await db<PingRow[]>`SELECT 1 as ok`;
      database = {
        ok: ping[0]?.ok === 1,
        message: ping[0]?.ok === 1 ? 'healthy' : 'query_failed',
      };

      const freshness = await db<FreshnessRow[]>`
        SELECT MAX(time) as last_seen_at
        FROM operations
      `;

      const lastSeenAt = freshness[0]?.last_seen_at ?? null;
      if (!lastSeenAt) {
        pipeline = {
          ok: false,
          lastSeenAt: null,
          lagSeconds: null,
          message: 'no_events_yet',
        };
      } else {
        const lagSeconds = Math.round((checkedAt.getTime() - lastSeenAt.getTime()) / 1000);
        pipeline = {
          ok: lagSeconds <= 180,
          lastSeenAt,
          lagSeconds,
          message: lagSeconds <= 180 ? 'fresh' : 'stale',
        };
      }
    } catch {
      database = {
        ok: false,
        message: 'query_error',
      };
      pipeline = {
        ok: false,
        lastSeenAt: null,
        lagSeconds: null,
        message: 'db_unavailable',
      };
    }

    return {
      checkedAt,
      collector,
      database,
      pipeline,
    };
  }),

  hourlyVolume: publicProcedure.query(async () => {
    const db = getDB();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const result = await db<VolumeRow[]>`
      SELECT 
        DATE_TRUNC('hour', time) as hour,
        COUNT(*) as call_count
      FROM operations
      WHERE time >= ${oneDayAgo}
      GROUP BY hour
      ORDER BY hour ASC
    `;

    // Fill in missing hours with 0
    const volumeByHour: Record<string, number> = {};
    for (let i = 23; i >= 0; i--) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourStr = hour.toISOString().slice(0, 13);
      volumeByHour[hourStr] = 0;
    }

    result.forEach((row) => {
      const hourStr = new Date(row.hour).toISOString().slice(0, 13);
      volumeByHour[hourStr] = Number(row.call_count || 0);
    });

    return Object.keys(volumeByHour)
      .sort()
      .slice(-24)
      .map((hour) => volumeByHour[hour]);
  }),
  summary: publicProcedure.query(async () => {
    const db = getDB();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      operationCountResult,
      errorRateResult,
      slowestResult,
      topFieldsResult,
      topClientsResult,
      lastSeenResult,
    ] = await Promise.all([
      db<CountRow[]>`
        SELECT COUNT(*) as count FROM operations
        WHERE time >= ${oneDayAgo}
      `,
      db<StatRow[]>`
        SELECT 
          COUNT(*) as total_calls,
          COUNT(*) FILTER (WHERE has_errors) as total_errors
        FROM operations
        WHERE time >= ${oneDayAgo}
      `,
      db<SlowRow[]>`
        SELECT field_path, AVG(p99_ms) as avg_p99
        FROM resolver_timings
        WHERE time >= ${oneDayAgo}
        GROUP BY field_path
        ORDER BY avg_p99 DESC
        LIMIT 5
      `,
      db<TopFieldRow[]>`
        SELECT type_name, field_name, SUM(call_count) as total_calls
        FROM field_usage
        WHERE time >= ${oneDayAgo}
        GROUP BY type_name, field_name
        ORDER BY total_calls DESC
        LIMIT 5
      `,
      db<ClientRow[]>`
        SELECT client_name, COUNT(*) as call_count, COUNT(*) FILTER (WHERE has_errors) as error_count
        FROM operations
        WHERE time >= ${oneDayAgo}
        GROUP BY client_name
        ORDER BY call_count DESC
        LIMIT 5
      `,
      db<LastSeenRow[]>`
        SELECT MAX(time) as last_seen_at
        FROM operations
      `,
    ]);

    const totalCalls = Number(errorRateResult[0]?.total_calls || 0);
    const totalErrors = Number(errorRateResult[0]?.total_errors || 0);

    return {
      operationsLast24h: Number(operationCountResult[0]?.count || 0),
      errorRate: totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0,
      slowestResolvers: slowestResult.map((row) => ({
        fieldPath: row.field_path,
        avgP99Ms: Number(row.avg_p99 || 0),
      })),
      topFields: topFieldsResult.map((row) => ({
        typeName: row.type_name,
        fieldName: row.field_name,
        callCount: Number(row.total_calls || 0),
      })),
      topClients: topClientsResult.map((row) => ({
        clientName: row.client_name || 'Unknown client',
        callCount: Number(row.call_count || 0),
        errorCount: Number(row.error_count || 0),
      })),
      lastSeenAt: lastSeenResult[0]?.last_seen_at ?? null,
    };
  }),
});

export default overviewRouter;


