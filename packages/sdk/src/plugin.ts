import type { DocumentNode, GraphQLResolveInfo, OperationDefinitionNode } from 'graphql';
import { RingBuffer, type BufferEvent } from './buffer';
import { initializeOTel, type OTelConfig, shutdownOTel } from './otel-init';
import {
  createOperationMetrics,
  initializeMetrics,
  recordFieldMetrics,
  recordOperationMetrics,
} from './otel-metrics';
import { createFieldSpan, createOperationSpan, finishSpan, initializeTracing } from './otel-tracing';
import { collectQueryMetrics } from './query-metrics';
import { UDPTransport } from './transport';

type OperationType = 'query' | 'mutation' | 'subscription';

interface HeadersLike {
  get(name: string): string | null;
}

interface RequestLike {
  operationName?: string | null;
  query?: string;
  http?: {
    headers?: HeadersLike;
  };
}

interface RequestContextLike {
  request?: RequestLike;
  document?: DocumentNode | null;
}

interface ResponseLike {
  errors?: readonly unknown[];
}

interface FieldResolverArgsLike {
  info?: GraphQLResolveInfo;
}

export interface GraphQLAnalyticsPluginOptions extends OTelConfig {
  host?: string;
  port?: number;
  batchSize?: number;
  enableUdpFallback?: boolean;
  bufferCapacity?: number;
  flushIntervalMs?: number;
  flushThreshold?: number;
}

interface TelemetryRuntime {
  operationMetrics: ReturnType<typeof createOperationMetrics>;
  udpTransport: UDPTransport | null;
  udpBuffer: RingBuffer | null;
}

let runtime: TelemetryRuntime | null = null;

function initializeRuntime(options: GraphQLAnalyticsPluginOptions): TelemetryRuntime {
  if (runtime) {
    return runtime;
  }

  initializeOTel(options);
  initializeTracing({ tracerName: 'graphql-apollo', tracerVersion: '1.0.0' });
  initializeMetrics({ meterName: 'graphql-apollo', meterVersion: '1.0.0' });

  let udpTransport: UDPTransport | null = null;
  let udpBuffer: RingBuffer | null = null;
  const shouldEnableUdp = options.enableUdpFallback ?? Boolean(options.host && options.port);

  if (shouldEnableUdp && options.host && options.port) {
    udpTransport = new UDPTransport({
      host: options.host,
      port: options.port,
      batchSize: options.batchSize,
    });

    udpBuffer = new RingBuffer({
      capacity: options.bufferCapacity,
      flushIntervalMs: options.flushIntervalMs,
      flushThreshold: options.flushThreshold,
      onFlush: (events) => {
        udpTransport?.send(events);
      },
    });
  }

  runtime = {
    operationMetrics: createOperationMetrics(),
    udpTransport,
    udpBuffer,
  };

  return runtime;
}

function inferOperationType(
  document: DocumentNode | null | undefined,
  operationName: string | null,
  query: string | undefined
): OperationType {
  const definitions = document?.definitions;
  if (definitions?.length) {
    const operations = definitions.filter(
      (definition): definition is OperationDefinitionNode => definition.kind === 'OperationDefinition'
    );
    const selected = operations.find((operation) => operation.name?.value === operationName) ?? operations[0];
    if (selected?.operation) {
      return selected.operation;
    }
  }

  const match = query?.match(/^\s*(query|mutation|subscription)\b/i);
  if (match?.[1] === 'mutation' || match?.[1] === 'subscription') {
    return match[1];
  }

  return 'query';
}

function resolverPath(info: GraphQLResolveInfo): string {
  const segments: string[] = [];
  let current: GraphQLResolveInfo['path'] | undefined = info.path;

  while (current) {
    if (typeof current.key === 'string') {
      segments.push(current.key);
    }
    current = current.prev ?? undefined;
  }

  segments.reverse();
  if (!segments.length) {
    return `${info.parentType.name}.${info.fieldName}`;
  }

  return segments.join('.');
}

function extractMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return undefined;
}

export function GraphQLAnalyticsPlugin(options: GraphQLAnalyticsPluginOptions = {}) {
  const telemetry = initializeRuntime(options);

  return {
    async requestDidStart(rawRequestContext: unknown) {
      const requestContext = (rawRequestContext as RequestContextLike) ?? {};
      const request = requestContext.request ?? {};
      const startTime = Date.now();
      const operationName = request.operationName ?? null;
      const operationType = inferOperationType(requestContext.document, operationName, request.query);
      const clientName = request.http?.headers?.get('x-graphql-client-name') ?? undefined;
      const queryMetrics = collectQueryMetrics(requestContext.document, operationName);
      const rootSpan = createOperationSpan(operationName, operationType, {
        clientName,
        queryDepth: queryMetrics.queryDepth,
        fieldCount: queryMetrics.fieldCount,
        complexityScore: queryMetrics.complexityScore,
      });

      const fieldUsage = new Map<string, { typeName: string; fieldName: string }>();
      const resolverTimings: BufferEvent['resolverTimings'] = [];

      return {
        async executionDidStart() {
          return {
            willResolveField(args: FieldResolverArgsLike) {
              const info = args.info;
              if (!info) {
                return undefined;
              }

              const startedAt = Date.now();
              const path = resolverPath(info);
              const span = createFieldSpan(path, rootSpan);
              const fieldKey = `${info.parentType.name}.${info.fieldName}`;
              fieldUsage.set(fieldKey, {
                typeName: info.parentType.name,
                fieldName: info.fieldName,
              });

              return (error?: unknown) => {
                const durationMs = Date.now() - startedAt;
                const hasError = Boolean(error);

                resolverTimings.push({ path, durationMs });
                recordFieldMetrics(telemetry.operationMetrics, fieldKey, durationMs, {
                  operationName,
                  operationType,
                  hasError,
                });
                finishSpan(span, durationMs, {
                  hasError,
                  errorMessage: extractMessage(error),
                });
              };
            },
          };
        },

        async willSendResponse(rawWillSendContext: unknown) {
          const willSendContext = rawWillSendContext as { response?: ResponseLike };

          try {
            const durationMs = Date.now() - startTime;
            const hasErrors = (willSendContext.response?.errors?.length ?? 0) > 0;

            recordOperationMetrics(
              telemetry.operationMetrics,
              {
                operationName,
                operationType,
                clientName,
                hasErrors,
              },
              {
                durationMs,
                fieldCount: queryMetrics.fieldCount,
                queryDepth: queryMetrics.queryDepth,
                complexityScore: queryMetrics.complexityScore,
              }
            );

            telemetry.udpBuffer?.push({
              operationName,
              operationType,
              fields: [...fieldUsage.values()],
              durationMs,
              resolverTimings,
              clientName,
              timestamp: Date.now(),
              hasErrors,
              queryDepth: queryMetrics.queryDepth,
              fieldCount: queryMetrics.fieldCount,
              complexityScore: queryMetrics.complexityScore,
            });

            finishSpan(rootSpan, durationMs, { hasError: hasErrors });
          } catch {
            finishSpan(rootSpan, Date.now() - startTime, { hasError: true });
          }
        },
      };
    },

    async serverWillStart() {
      return {
        async drainServer() {
          try {
            await telemetry.udpBuffer?.shutdown();
            telemetry.udpTransport?.close();
            await shutdownOTel();
          } catch {
            // SDK must not fail host shutdown.
          }
        },
      };
    },
  };
}

