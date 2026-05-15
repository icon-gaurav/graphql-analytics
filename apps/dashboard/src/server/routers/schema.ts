import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getDB } from '../db';
import { getSchemaFieldMetadata } from '../schema-metadata';

interface UsageRow {
  type_name: string;
  field_name: string;
  total_calls: string;
  last_seen_at: Date | null;
}

const schemaRouter = router({
  deprecatedFields: publicProcedure
    .input(z.object({ days: z.number().int().positive().default(30) }))
    .query(async ({ input }: { input: { days: number } }) => {
      const db = getDB();
      const threshold = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const schemaFields = await getSchemaFieldMetadata();
      const deprecatedFields = schemaFields.filter((field) => field.deprecated);

      const usageRows = await db<UsageRow[]>`
        SELECT
          type_name,
          field_name,
          SUM(call_count) FILTER (WHERE time >= ${threshold}) as total_calls,
          MAX(time) as last_seen_at
        FROM field_usage
        GROUP BY type_name, field_name
      `;

      const usageMap = new Map(
        usageRows.map((row) => [
          `${row.type_name}.${row.field_name}`,
          {
            totalCalls: Number(row.total_calls || 0),
            lastSeenAt: row.last_seen_at,
          },
        ])
      );

      return deprecatedFields.map((field) => {
        const usage = usageMap.get(`${field.typeName}.${field.fieldName}`);
        const callCount = usage?.totalCalls ?? 0;
        return {
          ...field,
          callCount,
          lastSeenAt: usage?.lastSeenAt ?? null,
          safeToRemove: callCount === 0,
        };
      });
    }),

  unusedFields: publicProcedure
    .input(z.object({ days: z.number().int().positive().default(30) }))
    .query(async ({ input }: { input: { days: number } }) => {
      const db = getDB();
      const threshold = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const schemaFields = await getSchemaFieldMetadata();

      const seenRows = await db<{ type_name: string; field_name: string }[]>`
        SELECT DISTINCT type_name, field_name
        FROM field_usage
        WHERE time >= ${threshold}
      `;

      const seen = new Set(seenRows.map((row) => `${row.type_name}.${row.field_name}`));

      return schemaFields
        .filter((field) => !seen.has(`${field.typeName}.${field.fieldName}`))
        .map((field) => ({
          ...field,
          safeToRemove: !field.deprecated,
        }));
    }),
});

export default schemaRouter;

