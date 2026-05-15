import { publicProcedure, router } from '../trpc';
import { getDB } from '../db';

interface CountRow { count: string }
interface StatRow { total_calls: string; total_errors: string }
interface SlowRow { field_path: string; avg_p99: string }
interface TopFieldRow { type_name: string; field_name: string; total_calls: string }
interface VolumeRow { hour: string; call_count: string }
interface ClientRow { client_name: string | null; call_count: string; error_count: string }
interface LastSeenRow { last_seen_at: Date | null }

const overviewRouter = router({
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


