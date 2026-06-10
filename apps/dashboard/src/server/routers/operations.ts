import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { getDB } from '../db';
import { getTableColumns } from '../feature-support';

type RangeInput = {
  from: Date;
  to: Date;
};

interface OperationRow {
  operation_name: string | null;
  operation_type: string;
  call_count: string;
  error_count: string;
  p50_ms: string;
  p95_ms: string;
  p99_ms: string;
}

interface ResolverRow {
  field_path: string;
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

interface OperationDetailRow {
  operation_name: string | null;
  operation_type: string;
  call_count: string;
  error_count: string;
  p50_ms: string;
  p95_ms: string;
  p99_ms: string;
}

interface OperationPayloadRow {
  operation_query: string | null;
  request_headers: Record<string, string> | null;
}

interface OperationTrendRow {
  hour: Date;
  call_count: string;
  error_count: string;
  p95_ms: string;
}

const operationsRouter = router({
  topOperations: publicProcedure
    .input(
      z.object({
        from: z.string().or(z.date()).transform((d) => new Date(d)),
        to: z.string().or(z.date()).transform((d) => new Date(d)),
        limit: z.number().int().positive().default(25),
      })
    )
    .query(async ({ input }: { input: RangeInput & { limit: number } }) => {
      const db = getDB();

      const result = await db<OperationRow[]>`
        SELECT
          operation_name,
          operation_type,
          COUNT(*) as call_count,
          COUNT(*) FILTER (WHERE has_errors) as error_count,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) as p50_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99_ms
        FROM operations
        WHERE time >= ${input.from} AND time <= ${input.to}
        GROUP BY operation_name, operation_type
        ORDER BY call_count DESC
        LIMIT ${input.limit}
      `;

      return result.map((row) => {
        const callCount = Number(row.call_count || 0);
        const errorCount = Number(row.error_count || 0);
        return {
          operationName: row.operation_name || 'anonymous',
          operationType: row.operation_type,
          callCount,
          errorCount,
          errorRate: callCount > 0 ? (errorCount / callCount) * 100 : 0,
          p50Ms: Number(row.p50_ms || 0),
          p95Ms: Number(row.p95_ms || 0),
          p99Ms: Number(row.p99_ms || 0),
        };
      });
    }),

  latencyBreakdown: publicProcedure
    .input(
      z.object({
        operationName: z.string().optional(),
        from: z.string().or(z.date()).transform((d) => new Date(d)),
        to: z.string().or(z.date()).transform((d) => new Date(d)),
        limit: z.number().int().positive().default(50),
      })
    )
    .query(async ({ input }: { input: RangeInput & { operationName?: string; limit: number } }) => {
      const db = getDB();
      const operationName = input.operationName || 'anonymous';

      const result = input.operationName
        ? await db<ResolverRow[]>`
            SELECT
              field_path,
              AVG(p50_ms) as avg_p50,
              AVG(p95_ms) as avg_p95,
              AVG(p99_ms) as avg_p99,
              SUM(call_count) as samples
            FROM resolver_timings
            WHERE time >= ${input.from}
              AND time <= ${input.to}
              AND operation_name = ${operationName}
            GROUP BY field_path
            ORDER BY avg_p99 DESC
            LIMIT ${input.limit}
          `
        : await db<ResolverRow[]>`
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
        from: z.string().or(z.date()).transform((d) => new Date(d)),
        to: z.string().or(z.date()).transform((d) => new Date(d)),
      })
    )
    .query(async ({ input }: { input: RangeInput }) => {
      const db = getDB();

      const result = await db<ErrorRateRow[]>`
        SELECT
          time_bucket('1 hour', time) as hour,
          COUNT(*) as total_calls,
          COUNT(*) FILTER (WHERE has_errors) as total_errors
        FROM operations
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

  operationDetails: publicProcedure
    .input(
      z.object({
        operationName: z.string().min(1),
        from: z.string().or(z.date()).transform((d) => new Date(d)),
        to: z.string().or(z.date()).transform((d) => new Date(d)),
      })
    )
    .query(async ({ input }: { input: RangeInput & { operationName: string } }) => {
      const db = getDB();
      const operationColumns = await getTableColumns('operations');
      const supportsOperationPayload =
        operationColumns.has('operation_query') && operationColumns.has('request_headers');

      const [result, payloadRows] = await Promise.all([
        db<OperationDetailRow[]>`
        SELECT
          COALESCE(operation_name, 'anonymous') as operation_name,
          operation_type,
          COUNT(*) as call_count,
          COUNT(*) FILTER (WHERE has_errors) as error_count,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) as p50_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99_ms
        FROM operations
        WHERE time >= ${input.from}
          AND time <= ${input.to}
          AND COALESCE(operation_name, 'anonymous') = ${input.operationName}
        GROUP BY COALESCE(operation_name, 'anonymous'), operation_type
        ORDER BY call_count DESC
        LIMIT 1
      `,
        supportsOperationPayload
          ? db<OperationPayloadRow[]>`
              SELECT
                operation_query,
                request_headers
              FROM operations
              WHERE time >= ${input.from}
                AND time <= ${input.to}
                AND COALESCE(operation_name, 'anonymous') = ${input.operationName}
              ORDER BY time DESC
              LIMIT 1
            `
          : Promise.resolve([] as OperationPayloadRow[]),
      ]);

      const row = result[0];
      if (!row) {
        return null;
      }
      const payload = payloadRows[0];

      const callCount = Number(row.call_count || 0);
      const errorCount = Number(row.error_count || 0);
      return {
        operationName: row.operation_name || 'anonymous',
        operationType: row.operation_type,
        callCount,
        errorCount,
        errorRate: callCount > 0 ? (errorCount / callCount) * 100 : 0,
        p50Ms: Number(row.p50_ms || 0),
        p95Ms: Number(row.p95_ms || 0),
        p99Ms: Number(row.p99_ms || 0),
        operationQuery: payload?.operation_query ?? null,
        requestHeaders: payload?.request_headers ?? null,
      };
    }),

  operationHourlyTrend: publicProcedure
    .input(
      z.object({
        operationName: z.string().min(1),
        from: z.string().or(z.date()).transform((d) => new Date(d)),
        to: z.string().or(z.date()).transform((d) => new Date(d)),
      })
    )
    .query(async ({ input }: { input: RangeInput & { operationName: string } }) => {
      const db = getDB();

      const result = await db<OperationTrendRow[]>`
        SELECT
          time_bucket('1 hour', time) as hour,
          COUNT(*) as call_count,
          COUNT(*) FILTER (WHERE has_errors) as error_count,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms
        FROM operations
        WHERE time >= ${input.from}
          AND time <= ${input.to}
          AND COALESCE(operation_name, 'anonymous') = ${input.operationName}
        GROUP BY hour
        ORDER BY hour
      `;

      return result.map((row) => {
        const callCount = Number(row.call_count || 0);
        const errorCount = Number(row.error_count || 0);
        return {
          hour: row.hour,
          callCount,
          errorCount,
          errorRate: callCount > 0 ? (errorCount / callCount) * 100 : 0,
          p95Ms: Number(row.p95_ms || 0),
        };
      });
    }),
});

export default operationsRouter;

