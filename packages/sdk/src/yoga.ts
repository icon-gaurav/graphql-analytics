import { RingBuffer, BufferEvent, FieldUsage } from './buffer';
import { UDPTransport } from './transport';

export interface GraphQLAnalyticsYogaOptions {
  host?: string;
  port?: number;
  bufferCapacity?: number;
  bufferFlushIntervalMs?: number;
  bufferFlushThreshold?: number;
}

export function useGraphQLAnalytics(
  options: GraphQLAnalyticsYogaOptions = {}
) {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 9000;

  const transport = new UDPTransport({ host, port });
  const buffer = new RingBuffer({
    capacity: options.bufferCapacity,
    flushIntervalMs: options.bufferFlushIntervalMs,
    flushThreshold: options.bufferFlushThreshold,
    onFlush: async (events) => {
      transport.send(events);
    },
  });

  return {
    onExecute({ args }: any) {
      const startTime = Date.now();
      const operationName: string | null =
        args.operationName ?? null;
      let operationType: BufferEvent['operationType'] = 'query';

      if (args.document?.definitions?.[0]?.operation) {
        operationType = args.document.definitions[0].operation;
      }

      return {
        onExecuteDone({ result }: any) {
          try {
            const durationMs = Date.now() - startTime;
            const hasErrors = (result.errors?.length ?? 0) > 0;

            const fields = new Set<string>();
            if (result.data && typeof result.data === 'object') {
              collectFields(result.data, '', fields);
            }

            const fieldUsages: FieldUsage[] = Array.from(fields).map((fp) => {
              const parts = fp.split('.');
              return {
                typeName: parts[0] ?? 'Unknown',
                fieldName: parts[parts.length - 1] ?? 'Unknown',
              };
            });

            const event: BufferEvent = {
              operationName,
              operationType,
              fields: fieldUsages,
              durationMs,
              resolverTimings: [],
              timestamp: Date.now(),
              hasErrors,
            };

            buffer.push(event);
          } catch (_e) {
            // Silently swallow
          }
        },
      };
    },
  };
}

function collectFields(
  obj: Record<string, unknown>,
  path: string,
  fields: Set<string>
): void {
  for (const key in obj) {
    const fullPath = path ? `${path}.${key}` : key;
    fields.add(fullPath);
    const val = obj[key];
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object') {
            collectFields(item as Record<string, unknown>, fullPath, fields);
          }
        }
      } else {
        collectFields(val as Record<string, unknown>, fullPath, fields);
      }
    }
  }
}

