import { RingBuffer, BufferEvent, FieldUsage } from './buffer';
import { UDPTransport } from './transport';

export interface GraphQLAnalyticsPluginOptions {
  host?: string;
  port?: number;
  bufferCapacity?: number;
  bufferFlushIntervalMs?: number;
  bufferFlushThreshold?: number;
}

export function GraphQLAnalyticsPlugin(
  options: GraphQLAnalyticsPluginOptions = {}
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
    async requestDidStart(requestContext: any) {
      const startTime = Date.now();
      const operationName = requestContext.request.operationName ?? null;
      const fields = new Set<string>();
      let operationType = 'query';

      if (requestContext.request.query) {
        const match = (requestContext.request.query as string).match(/^\s*(\w+)/);
        if (match?.[1]) {
          operationType = match[1].toLowerCase();
        }
      }

      return {
        async executionDidStart() {
          return {
            willResolveField({ info }: any) {
              try {
                fields.add(info.parentType.name + '.' + info.fieldName);
              } catch (_e) {
                // Silently swallow
              }
            },
          };
        },

        async willSendResponse(willSendContext: any) {
          try {
            const durationMs = Date.now() - startTime;
            const hasErrors =
              (willSendContext.response.errors?.length ?? 0) > 0;

            const fieldUsages: FieldUsage[] = Array.from(fields).map((fp) => {
              const [typeName, fieldName] = fp.split('.');
              return { typeName: typeName ?? fp, fieldName: fieldName ?? fp };
            });

            const event: BufferEvent = {
              operationName,
              operationType: operationType as BufferEvent['operationType'],
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

    async serverWillStart() {
      return {
        async drainServer() {
          await buffer.shutdown();
          transport.close();
        },
      };
    },
  };
}

