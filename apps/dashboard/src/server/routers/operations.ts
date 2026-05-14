import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { getDB } from '../db';

interface TimingRow {
  field_path: string;
  call_count: string;
  error_count: string;
  avg_p50: string;
  avg_p95: string;
  avg_p99: string;
  samples: string;
}

interface ErrorRateRow {
  hour: Date;
  total_calls: string;
  total_errors: string;
}

const operationsRouter = router({
  topOperations: publicProcedure
    .input(
      z.object({
        from: z.string().or(z.date()).transform(d => new Date(d)),
        to: z.string().or(z.date()).transform(d => new Date(d)),
        limit: z.number().int().positive().default(50),
      })
    )
    .query(async ({ input }: { input: { from: Date; to: Date; limit: number } }) => {
      const db = getDB();

      const result = await db<TimingRow[]>`
        SELECT 
          field_path,
          SUM(call_count) as call_count,
          SUM(error_count) as error_count,
          AVG(p50_ms) as avg_p50,
          AVG(p95_ms) as avg_p95,
          AVG(p99_ms) as avg_p99
        FROM resolver_timings
        WHERE time >= ${input.from} AND time <= ${input.to}
        GROUP BY field_path
        ORDER BY call_count DESC
        LIMIT ${input.limit}
      `;

      return result.map((row) => ({
        fieldPath: row.field_path,
        callCount: Number(row.call_count || 0),
        errorCount: Number(row.error_count || 0),
        avgP50: Number(row.avg_p50 || 0),
        avgP95: Number(row.avg_p95 || 0),
        avgP99: Number(row.avg_p99 || 0),
      }));
    }),

  latencyBreakdown: publicProcedure
    .input(
      z.object({
        from: z.string().or(z.date()).transform(d => new Date(d)),
        to: z.string().or(z.date()).transform(d => new Date(d)),
        limit: z.number().int().positive().default(50),
      })
    )
    .query(async ({ input }: { input: { from: Date; to: Date; limit: number } }) => {
      const db = getDB();

      const result = await db<TimingRow[]>`
        SELECT 
          field_path,
          AVG(p50_ms) as avg_p50,
          AVG(p95_ms) as avg_p95,
          AVG(p99_ms) as avg_p99,
          SUM(call_count) as samples
        FROM resolver_timings
        WHERE time >= ${input.from} AND time <= ${input.to}
        GROUP BY field_path
        ORDER BY avg_p99 DESC
        LIMIT ${input.limit}
      `;

      return result.map((row) => ({
        fieldPath: row.field_path,
        p50Ms: Number(row.avg_p50 || 0),
        p95Ms: Number(row.avg_p95 || 0),
        p99Ms: Number(row.avg_p99 || 0),
        samples: Number(row.samples || 0),
      }));
    }),

  errorRate: publicProcedure
    .input(
      z.object({
        from: z.string().or(z.date()).transform(d => new Date(d)),
        to: z.string().or(z.date()).transform(d => new Date(d)),
      })
    )
    .query(async ({ input }: { input: { from: Date; to: Date } }) => {
      const db = getDB();

      const result = await db<ErrorRateRow[]>`
        SELECT 
          time_bucket('1 hour', time) as hour,
          SUM(call_count) as total_calls,
          SUM(error_count) as total_errors
        FROM field_usage
        WHERE time >= ${input.from} AND time <= ${input.to}
        GROUP BY hour
        ORDER BY hour
      `;

      return result.map((row) => {
        const totalCalls = Number(row.total_calls || 0);
        const totalErrors = Number(row.total_errors || 0);
        return {
          hour: row.hour,
          totalCalls,
          totalErrors,
          errorRate: totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0,
        };
      });
    }),
});

export default operationsRouter;


