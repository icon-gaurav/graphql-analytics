import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { getDB } from '../db';
import { getTableColumns } from '../feature-support';

interface ComplexQueryRow {
  operation_name: string | null;
  operation_type: string;
  client_name: string | null;
  call_count: string;
  error_count: string;
  avg_depth: string;
  max_depth: string;
  avg_complexity: string;
  max_complexity: string;
  p95_duration_ms: string;
}

const metricsInput = z.object({
  from: z.string().or(z.date()).transform((d) => new Date(d)),
  to: z.string().or(z.date()).transform((d) => new Date(d)),
  limit: z.number().int().positive().default(20),
});

const securityRouter = router({
  complexityOverview: publicProcedure
    .input(metricsInput.omit({ limit: true }))
    .query(async ({ input }: { input: { from: Date; to: Date } }) => {
      const columns = await getTableColumns('operations');
      if (!columns.has('query_depth') || !columns.has('complexity_score')) {
        return {
          available: false,
          avgDepth: 0,
          maxDepth: 0,
          avgComplexity: 0,
          maxComplexity: 0,
          highRiskRequests: 0,
        };
      }

      const db = getDB();
      const [row] = await db<{
        avg_depth: string;
        max_depth: string;
        avg_complexity: string;
        max_complexity: string;
        high_risk_requests: string;
      }[]>`
        SELECT
          AVG(query_depth) as avg_depth,
          MAX(query_depth) as max_depth,
          AVG(complexity_score) as avg_complexity,
          MAX(complexity_score) as max_complexity,
          COUNT(*) FILTER (WHERE complexity_score >= 50 OR query_depth >= 8) as high_risk_requests
        FROM operations
        WHERE time >= ${input.from} AND time <= ${input.to}
      `;

      return {
        available: true,
        avgDepth: Number(row?.avg_depth || 0),
        maxDepth: Number(row?.max_depth || 0),
        avgComplexity: Number(row?.avg_complexity || 0),
        maxComplexity: Number(row?.max_complexity || 0),
        highRiskRequests: Number(row?.high_risk_requests || 0),
      };
    }),

  complexQueries: publicProcedure
    .input(metricsInput)
    .query(async ({ input }: { input: { from: Date; to: Date; limit: number } }) => {
      const columns = await getTableColumns('operations');
      if (!columns.has('query_depth') || !columns.has('complexity_score')) {
        return [];
      }

      const db = getDB();
      const rows = await db<ComplexQueryRow[]>`
        SELECT
          operation_name,
          operation_type,
          client_name,
          COUNT(*) as call_count,
          COUNT(*) FILTER (WHERE has_errors) as error_count,
          AVG(query_depth) as avg_depth,
          MAX(query_depth) as max_depth,
          AVG(complexity_score) as avg_complexity,
          MAX(complexity_score) as max_complexity,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms
        FROM operations
        WHERE time >= ${input.from} AND time <= ${input.to}
        GROUP BY operation_name, operation_type, client_name
        ORDER BY max_complexity DESC, max_depth DESC, p95_duration_ms DESC
        LIMIT ${input.limit}
      `;

      return rows.map((row) => ({
        operationName: row.operation_name || 'anonymous',
        operationType: row.operation_type,
        clientName: row.client_name || 'Unknown client',
        callCount: Number(row.call_count || 0),
        errorCount: Number(row.error_count || 0),
        avgDepth: Number(row.avg_depth || 0),
        maxDepth: Number(row.max_depth || 0),
        avgComplexity: Number(row.avg_complexity || 0),
        maxComplexity: Number(row.max_complexity || 0),
        p95DurationMs: Number(row.p95_duration_ms || 0),
      }));
    }),
});

export default securityRouter;

