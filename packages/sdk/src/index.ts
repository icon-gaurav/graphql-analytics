/**
 * @graphql-analytics/sdk
 * TypeScript SDK for integrating GraphQL Analytics with your GraphQL server.
 * 
 * Now powered by OpenTelemetry for standardized observability.
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

// Legacy exports (kept for backward compatibility)
export { RingBuffer } from './buffer';
export type {
  BufferEvent,
  FieldUsage,
  ResolverTiming,
  RingBufferOptions,
} from './buffer';

export { GraphQLAnalyticsPlugin } from './plugin';
export type { GraphQLAnalyticsPluginOptions } from './plugin';

export { useGraphQLAnalytics } from './yoga';
export type { GraphQLAnalyticsYogaOptions } from './yoga';

export { UDPTransport } from './transport';
export type { TransportOptions } from './transport';

export type {
  OperationEvent,
  FieldUsage as SchemaFieldUsage,
  ResolverTiming as SchemaResolverTiming,
} from './schema';

