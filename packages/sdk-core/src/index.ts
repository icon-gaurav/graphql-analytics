/**
 * @graphql-analytics/sdk-core
 * Core OpenTelemetry instrumentation for GraphQL Analytics.
 * Use the framework-specific packages for easier integration:
 *   - @graphql-analytics/sdk-apollo  (Apollo Server)
 *   - @graphql-analytics/sdk-express (Express + Apollo)
 *   - @graphql-analytics/sdk-fastify (Fastify + Apollo/Mercurius)
 */

// OpenTelemetry exports
export { initializeOTel, shutdownOTel, getTracerProvider, getMeterProvider } from './otel-init';
export type { OTelConfig } from './otel-init';

export {
  initializeTracing,
  getTracer,
  createOperationSpan,
  createFieldSpan,
  finishSpan,
  withSpan,
} from './otel-tracing';
export type { OTelTracingConfig } from './otel-tracing';

export {
  initializeMetrics,
  getMetrics,
  createOperationMetrics,
  recordOperationMetrics,
  recordFieldMetrics,
} from './otel-metrics';
export type { OTelMetricsConfig } from './otel-metrics';

// Plugin exports
export { GraphQLAnalyticsPlugin } from './plugin';
export type { GraphQLAnalyticsPluginOptions } from './plugin';

export { useGraphQLAnalytics } from './yoga';
export type { GraphQLAnalyticsYogaOptions } from './yoga';


export type {
  OperationEvent,
  FieldUsage as SchemaFieldUsage,
  ResolverTiming as SchemaResolverTiming,
} from './schema';

