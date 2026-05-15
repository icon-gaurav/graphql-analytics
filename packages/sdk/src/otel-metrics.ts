import { metrics } from '@opentelemetry/api';
import type { Attributes, Meter } from '@opentelemetry/api';
import type { Counter, Histogram } from '@opentelemetry/api';

export interface OTelMetricsConfig {
  meterName?: string;
  meterVersion?: string;
}

interface GraphQLMetricsInstruments {
  operationCounter: Counter;
  operationDuration: Histogram;
  fieldCounter: Counter;
  fieldDuration: Histogram;
  errorCounter: Counter;
  complexityHistogram: Histogram;
  depthHistogram: Histogram;
  fieldCountHistogram: Histogram;
}

let meterInstance: Meter | null = null;

export function initializeMetrics(config: OTelMetricsConfig = {}): Meter {
  const { meterName = 'graphql-analytics', meterVersion = '1.0.0' } = config;

  meterInstance = metrics.getMeter(meterName, meterVersion);

  return meterInstance;
}

export function getMetrics(): Meter {
  if (!meterInstance) {
    meterInstance = metrics.getMeter('graphql-analytics', '1.0.0');
  }
  return meterInstance;
}

/**
 * Create metrics instruments for GraphQL operations
 */
export function createOperationMetrics(): GraphQLMetricsInstruments {
  const meter = getMetrics();

  return {
    // Counter for operation invocations
    operationCounter: meter.createCounter('graphql.operations.total', {
      description: 'Total number of GraphQL operations executed',
      unit: '{operation}',
    }),

    // Histogram for operation duration
    operationDuration: meter.createHistogram('graphql.operations.duration_ms', {
      description: 'GraphQL operation execution duration in milliseconds',
      unit: 'ms',
    }),

    // Counter for field resolutions
    fieldCounter: meter.createCounter('graphql.fields.resolved.total', {
      description: 'Total number of field resolutions',
      unit: '{field}',
    }),

    // Histogram for field resolution time
    fieldDuration: meter.createHistogram('graphql.fields.duration_ms', {
      description: 'Field resolution duration in milliseconds',
      unit: 'ms',
    }),

    // Counter for errors
    errorCounter: meter.createCounter('graphql.errors.total', {
      description: 'Total number of GraphQL errors',
      unit: '{error}',
    }),

    complexityHistogram: meter.createHistogram('graphql.query.complexity', {
      description: 'Query complexity score',
      unit: '{score}',
    }),

    depthHistogram: meter.createHistogram('graphql.query.depth', {
      description: 'Query depth',
      unit: '{depth}',
    }),

    fieldCountHistogram: meter.createHistogram('graphql.query.field_count', {
      description: 'Number of fields in query',
      unit: '{count}',
    }),
  };
}

/**
 * Record operation metrics
 */
export function recordOperationMetrics(
  instruments: GraphQLMetricsInstruments,
  attributes: {
    operationName?: string | null;
    operationType: 'query' | 'mutation' | 'subscription';
    clientName?: string;
    hasErrors: boolean;
  },
  measurements: {
    durationMs: number;
    fieldCount: number;
    queryDepth: number;
    complexityScore: number;
  }
) {
  const otelAttributes: Attributes = {
    'graphql.operation.name': attributes.operationName ?? 'unknown',
    'graphql.operation.type': attributes.operationType,
    'graphql.client.name': attributes.clientName ?? 'unknown',
    'error': attributes.hasErrors,
  };

  // Record operation count
  instruments.operationCounter.add(1, otelAttributes);

  // Record operation duration
  instruments.operationDuration.record(measurements.durationMs, otelAttributes);

  // Record errors if present
  if (attributes.hasErrors) {
    instruments.errorCounter.add(1, otelAttributes);
  }

  // Record query metrics
  instruments.complexityHistogram.record(measurements.complexityScore, otelAttributes);
  instruments.depthHistogram.record(measurements.queryDepth, otelAttributes);
  instruments.fieldCountHistogram.record(measurements.fieldCount, otelAttributes);
}

/**
 * Record field resolution metrics
 */
export function recordFieldMetrics(
  instruments: GraphQLMetricsInstruments,
  fieldPath: string,
  durationMs: number,
  attributes: {
    operationName?: string | null;
    operationType: 'query' | 'mutation' | 'subscription';
    hasError?: boolean;
  }
) {
  const [typeName, fieldName] = fieldPath.split('.');

  const otelAttributes: Attributes = {
    'graphql.field.path': fieldPath,
    'graphql.field.type': typeName ?? 'unknown',
    'graphql.field.name': fieldName ?? 'unknown',
    'graphql.operation.name': attributes.operationName ?? 'unknown',
    'graphql.operation.type': attributes.operationType,
    'error': attributes.hasError ?? false,
  };

  instruments.fieldCounter.add(1, otelAttributes);
  instruments.fieldDuration.record(durationMs, otelAttributes);
}


