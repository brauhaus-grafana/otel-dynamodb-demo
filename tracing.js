/**
 * OpenTelemetry bootstrap — must run before any AWS SDK or DynamoDB imports
 * so that DynamoDB calls are automatically instrumented.
 */
import { initializeGrafana } from './grafana.js';
import { initializeLogs } from './logging.js';
import { initializeMetrics } from './metrics.js';

const otelConfig = {
  serviceName: process.env.OTEL_SERVICE_NAME || 'otel-dynamodb-demo',
  serviceNamespace: process.env.OTEL_SERVICE_NAMESPACE || 'demo',
  serviceVersion: process.env.OTEL_SERVICE_VERSION || '1.0.0',
  environment: process.env.OTEL_ENVIRONMENT || 'development',
  exporterEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_ENDPOINT ||
    'http://localhost:4318/v1/traces',
  exporterToken: process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('Authorization')
    ? process.env.OTEL_EXPORTER_OTLP_HEADERS.split('Authorization=')[1]?.trim()
    : process.env.GRAFANA_OTEL_TOKEN,
  debugEnabled: process.env.OTEL_DEBUG === 'true',
};

export const tracerProvider = initializeGrafana(otelConfig);
export const logProvider = initializeLogs(otelConfig);
export const metricProvider = initializeMetrics(otelConfig);
