import {
  context,
  Span,
  SpanStatusCode,
  trace,
  Tracer,
  type Attributes,
} from '@opentelemetry/api';

export interface OTelTracingConfig {
  tracerName?: string;
  tracerVersion?: string;
}

let tracerInstance: Tracer | null = null;

export function initializeTracing(config: OTelTracingConfig = {}): Tracer {
  const { tracerName = 'graphql-analytics', tracerVersion = '1.0.0' } = config;

  tracerInstance = trace.getTracer(tracerName, tracerVersion);

  return tracerInstance;
}

export function getTracer(): Tracer {
  if (!tracerInstance) {
    tracerInstance = trace.getTracer('graphql-analytics', '1.0.0');
  }
  return tracerInstance;
}

/**
 * Create a root span for a GraphQL operation
 */
export function createOperationSpan(
  operationName: string | null,
  operationType: 'query' | 'mutation' | 'subscription',
  attributes: {
    clientName?: string;
    queryDepth?: number;
    fieldCount?: number;
    complexityScore?: number;
  }
): Span {
  const tracer = getTracer();

  const spanName = operationName ? `graphql.${operationType} ${operationName}` : `graphql.${operationType}`;

  return tracer.startSpan(spanName, {
    attributes: {
      'graphql.operation.type': operationType,
      'graphql.operation.name': operationName ?? 'anonymous',
      'graphql.client.name': attributes.clientName ?? 'unknown',
      'graphql.query.depth': attributes.queryDepth ?? 0,
      'graphql.query.field_count': attributes.fieldCount ?? 0,
      'graphql.query.complexity_score': attributes.complexityScore ?? 0,
    },
  });
}

/**
 * Create a child span for field resolution
 */
export function createFieldSpan(fieldPath: string, parentSpan?: Span): Span {
  const tracer = getTracer();
  const [typeName, fieldName] = fieldPath.split('.');

  const spanName = `graphql.field ${fieldPath}`;
  const spanOptions = {
    attributes: {
      'graphql.field.path': fieldPath,
      'graphql.field.type': typeName ?? 'unknown',
      'graphql.field.name': fieldName ?? 'unknown',
    },
  };

  // If parent span provided, use it as context
  if (parentSpan) {
    const ctx = trace.setSpan(context.active(), parentSpan);
    return tracer.startSpan(spanName, spanOptions, ctx);
  }

  return tracer.startSpan(spanName, spanOptions);
}

/**
 * Finish span with duration and error handling
 */
export function finishSpan(
  span: Span,
  durationMs: number,
  options: {
    hasError?: boolean;
    errorMessage?: string;
  } = {}
) {
  if (!span) return;

  if (options.hasError) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: options.errorMessage });
    span.addEvent('error', { 'error.type': 'graphql' });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }

  span.addEvent('end', { 'duration_ms': durationMs });
  span.end();
}

/**
 * Run a function within a span context
 */
export async function withSpan<T>(
  spanName: string,
  fn: () => T | Promise<T>,
  attributes?: Attributes
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(spanName, { attributes });

  try {
    const result = await fn();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    if (err instanceof Error || typeof err === 'string') {
      span.recordException(err);
    } else {
      span.recordException(new Error('Unknown error'));
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    throw err;
  } finally {
    span.end();
  }
}



