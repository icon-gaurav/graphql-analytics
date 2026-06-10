import type { DocumentNode, GraphQLResolveInfo, OperationDefinitionNode } from 'graphql';
import { initializeOTel, type OTelConfig, shutdownOTel } from './otel-init';
import {
  createOperationMetrics,
  initializeMetrics,
  recordFieldMetrics,
  recordOperationMetrics,
} from './otel-metrics';
import { createFieldSpan, createOperationSpan, finishSpan, initializeTracing } from './otel-tracing';
import { collectQueryMetrics } from './query-metrics';

type OperationType = 'query' | 'mutation' | 'subscription';

interface ResolverTiming {
  path: string;
  durationMs: number;
}

interface YogaExecuteArgs {
  operationName?: string | null;
  query?: string;
  document?: DocumentNode;
  contextValue?: {
    request?: {
      headers?: {
        get(name: string): string | null;
      };
    };
  };
}

export interface GraphQLAnalyticsYogaOptions extends OTelConfig {
  // OTel configuration is inherited from OTelConfig
}

interface TelemetryRuntime {
  operationMetrics: ReturnType<typeof createOperationMetrics>;
}

let runtime: TelemetryRuntime | null = null;

function initializeRuntime(options: GraphQLAnalyticsYogaOptions): TelemetryRuntime {
  if (runtime) {
    return runtime;
  }

  initializeOTel(options);
  initializeTracing({ tracerName: 'graphql-yoga', tracerVersion: '1.0.0' });
  initializeMetrics({ meterName: 'graphql-yoga', meterVersion: '1.0.0' });

  runtime = {
    operationMetrics: createOperationMetrics(),
  };

  return runtime;
}

function inferOperationType(document: DocumentNode | undefined, operationName: string | null): OperationType {
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
  return segments.length ? segments.join('.') : `${info.parentType.name}.${info.fieldName}`;
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

function extractRequestHeaders(headers: { get(name: string): string | null } | undefined): Record<string, string> {
  const headersWithForEach = headers as unknown as {
    forEach?: (callback: (value: string, key: string) => void) => void;
  };

  if (!headersWithForEach || typeof headersWithForEach.forEach !== 'function') {
    return {};
  }

  const output: Record<string, string> = {};
  try {
    headersWithForEach.forEach((value, key) => {
      if (typeof value === 'string' && value.length > 0) {
        output[key] = value;
      }
    });
  } catch {
    return {};
  }

  return output;
}

export function useGraphQLAnalytics(options: GraphQLAnalyticsYogaOptions = {}) {
  const telemetry = initializeRuntime(options);

  return {
    onExecute(payload: { args: YogaExecuteArgs }) {
      const args = payload.args;
      const startTime = Date.now();
      const operationName = args.operationName ?? null;
      const operationQuery = args.query ?? '';
      const operationType = inferOperationType(args.document, operationName);
      const queryMetrics = collectQueryMetrics(args.document, operationName);
      const clientName = args.contextValue?.request?.headers?.get('x-graphql-client-name') ?? undefined;
      const requestHeaders = extractRequestHeaders(args.contextValue?.request?.headers);

      const rootSpan = createOperationSpan(operationName, operationType, {
        clientName,
        queryDepth: queryMetrics.queryDepth,
        fieldCount: queryMetrics.fieldCount,
        complexityScore: queryMetrics.complexityScore,
      });
      rootSpan.setAttributes({
        'graphql.operation.query': operationQuery,
        'graphql.request.headers_json': JSON.stringify(requestHeaders),
      });

       const fieldUsage = new Map<string, { typeName: string; fieldName: string }>();
       const resolverTimings: ResolverTiming[] = [];

      return {
        onResolverCalled(resolverPayload: { info?: GraphQLResolveInfo }) {
          const info = resolverPayload.info;
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

          return ({ error }: { error?: unknown } = {}) => {
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

         onExecuteDone(payloadDone: { result?: { errors?: readonly unknown[] } }) {
           try {
             const durationMs = Date.now() - startTime;
             const hasErrors = (payloadDone.result?.errors?.length ?? 0) > 0;

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

             finishSpan(rootSpan, durationMs, { hasError: hasErrors });
           } catch {
             finishSpan(rootSpan, Date.now() - startTime, { hasError: true });
           }
         },
      };
    },

     async onDispose() {
       try {
         await shutdownOTel();
       } catch {
         // SDK must never fail host shutdown.
       }
     },
  };
}



