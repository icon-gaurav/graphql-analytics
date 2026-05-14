import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { getDB } from '../db';

interface FieldRow {
  type_name: string;
  field_name: string;
  total_calls: string;
  total_errors: string;
}

interface TrendRow {
  hour: Date;
  call_count: string;
}

const fieldsRouter = router({
  fieldUsage: publicProcedure
    .input(
      z.object({
        from: z.string().or(z.date()).transform(d => new Date(d)),
        to: z.string().or(z.date()).transform(d => new Date(d)),
        limit: z.number().int().positive().default(20),
      })
    )
    .query(async ({ input }: { input: { from: Date; to: Date; limit: number } }) => {
      const db = getDB();

      const result = await db<FieldRow[]>`
        SELECT 
          type_name,
          field_name,
          SUM(call_count) as total_calls,
          SUM(error_count) as total_errors
        FROM field_usage
        WHERE time >= ${input.from} AND time <= ${input.to}
        GROUP BY type_name, field_name
        ORDER BY total_calls DESC
        LIMIT ${input.limit}
      `;

      return result.map((row) => ({
        typeName: row.type_name,
        fieldName: row.field_name,
        callCount: Number(row.total_calls || 0),
        errorCount: Number(row.total_errors || 0),
      }));
    }),

  unusedFields: publicProcedure
    .input(
      z.object({
        daysSince: z.number().int().positive().default(30),
      })
    )
    .query(async ({ input }: { input: { daysSince: number } }) => {
      const db = getDB();
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - input.daysSince);

      const result = await db<{ type_name: string; field_name: string }[]>`
        SELECT DISTINCT type_name, field_name
        FROM field_usage
        WHERE time > ${threshold}
        ORDER BY type_name, field_name
      `;

      return result.map((row) => ({
        typeName: row.type_name,
        fieldName: row.field_name,
      }));
    }),

  fieldTrend: publicProcedure
    .input(
      z.object({
        typeName: z.string(),
        fieldName: z.string(),
        from: z.string().or(z.date()).transform(d => new Date(d)),
        to: z.string().or(z.date()).transform(d => new Date(d)),
      })
    )
    .query(async ({ input }: { input: { typeName: string; fieldName: string; from: Date; to: Date } }) => {
      const db = getDB();

      const result = await db<TrendRow[]>`
        SELECT 
          time_bucket('1 hour', time) as hour,
          SUM(call_count) as call_count
        FROM field_usage
        WHERE type_name = ${input.typeName}
          AND field_name = ${input.fieldName}
          AND time >= ${input.from}
          AND time <= ${input.to}
        GROUP BY hour
        ORDER BY hour
      `;

      return result.map((row) => ({
        hour: row.hour,
        callCount: Number(row.call_count || 0),
      }));
    }),
});

export default fieldsRouter;


