/**
 * OpenTelemetry metrics helper.
 * Exports metrics to OTLP.
 */
import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { URL } from 'url';

let meter;

function resolveMetricsEndpoint(otelConfig) {
  if (process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) {
    return process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  }

  const endpoint = otelConfig.exporterEndpoint;
  try {
    const url = new URL(endpoint);
    if (url.pathname.endsWith('/v1/traces')) {
      url.pathname = '/v1/metrics';
    } else if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/v1/metrics';
    }
    return url.toString();
  } catch {
    return endpoint;
  }
}

export function initializeMetrics(otelConfig) {
  const resourceAttributes = {};
  resourceAttributes[SEMRESATTRS_SERVICE_NAME] = otelConfig.serviceName;
  resourceAttributes['service.namespace'] = otelConfig.serviceNamespace;
  resourceAttributes['service.version'] = otelConfig.serviceVersion;
  resourceAttributes['deployment.environment'] = otelConfig.environment;

  const resource = new Resource(resourceAttributes);

  const headers = {};
  if (otelConfig.exporterToken) {
    headers.Authorization = `Basic ${otelConfig.exporterToken}`;
  }

  const metricExporter = new OTLPMetricExporter({
    url: resolveMetricsEndpoint(otelConfig),
    headers,
    timeoutMillis: 1000,
    compression: 'gzip',
  });

  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 10000,
  });

  let provider;
  if (typeof MeterProvider.prototype.addMetricReader === 'function') {
    provider = new MeterProvider({ resource });
    provider.addMetricReader(reader);
  } else {
    provider = new MeterProvider({ resource, readers: [reader] });
  }

  metrics.setGlobalMeterProvider(provider);
  meter = metrics.getMeter(otelConfig.serviceName || 'otel-dynamodb-demo');

  return provider;
}

export function getMeter() {
  if (!meter) {
    meter = metrics.getMeter('otel-dynamodb-demo');
  }
  return meter;
}
