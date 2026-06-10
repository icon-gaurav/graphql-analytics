import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export interface OTelConfig {
  serviceName?: string;
  collectorUrl?: string;
  metricsIntervalMs?: number;
  enabled?: boolean;
}

let tracerProviderInstance: NodeTracerProvider | null = null;
let meterProviderInstance: MeterProvider | null = null;
let shutdownHookRegistered = false;

export function initializeOTel(
  config: OTelConfig = {}
): { tracerProvider: NodeTracerProvider; meterProvider: MeterProvider } | null {
  if (tracerProviderInstance && meterProviderInstance) {
    return { tracerProvider: tracerProviderInstance, meterProvider: meterProviderInstance };
  }

  const {
    serviceName = 'graphql-analytics-sdk',
    collectorUrl = process.env['GRAPHQL_ANALYTICS_COLLECTOR_URL'] ?? 'http://localhost:4318',
    metricsIntervalMs = 30000,
    enabled = true,
  } = config;

  if (!enabled) {
    return null;
  }

  try {
    const resource = resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    });

    const traceExporter = new OTLPTraceExporter({
      url: `${collectorUrl}/v1/traces`,
    });

    tracerProviderInstance = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(traceExporter)],
    });
    tracerProviderInstance.register();

    const metricExporter = new OTLPMetricExporter({
      url: `${collectorUrl}/v1/metrics`,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: metricsIntervalMs,
    });

    meterProviderInstance = new MeterProvider({
      resource,
      readers: [metricReader],
    });
    metrics.setGlobalMeterProvider(meterProviderInstance);

    if (!shutdownHookRegistered) {
      shutdownHookRegistered = true;
      process.once('SIGTERM', () => {
        void shutdownOTel();
      });
    }

    return { tracerProvider: tracerProviderInstance, meterProvider: meterProviderInstance };
  } catch {
    tracerProviderInstance = null;
    meterProviderInstance = null;
    return null;
  }
}

export async function shutdownOTel(): Promise<void> {
  try {
    if (tracerProviderInstance) {
      await tracerProviderInstance.shutdown();
      tracerProviderInstance = null;
    }
    if (meterProviderInstance) {
      await meterProviderInstance.shutdown();
      meterProviderInstance = null;
    }
  } catch {
    // SDK must never surface telemetry failures.
  }
}

export function getTracerProvider(): NodeTracerProvider | null {
  return tracerProviderInstance;
}

export function getMeterProvider(): MeterProvider | null {
  return meterProviderInstance;
}








