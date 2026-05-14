/**
 * Shared payload schema for SDK events.
 * Matches the protobuf definition expected by the collector.
 */

export interface OperationEvent {
  operationName: string | null;
  operationType: 'query' | 'mutation' | 'subscription';
  fields: FieldUsage[];
  durationMs: number;
  resolverTimings: ResolverTiming[];
  clientName?: string;
  timestamp: number;
  hasErrors: boolean;
}

export interface FieldUsage {
  typeName: string;
  fieldName: string;
}

export interface ResolverTiming {
  path: string;
  durationMs: number;
}

