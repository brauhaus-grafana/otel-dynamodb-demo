/**
 * OpenTelemetry logging helper.
 * Emits logs to OTLP and mirrors them to console.
 */
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { URL } from 'url';

let logger;
let debugEnabled = false;

function resolveLogsEndpoint(otelConfig) {
  if (process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
    return process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  }

  const endpoint = otelConfig.exporterEndpoint;
  try {
    const url = new URL(endpoint);
    if (url.pathname.endsWith('/v1/traces')) {
      url.pathname = '/v1/logs';
    } else if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/v1/logs';
    }
    return url.toString();
  } catch {
    return endpoint;
  }
}

export function initializeLogs(otelConfig) {
  debugEnabled = otelConfig.debugEnabled;

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

  const logExporter = new OTLPLogExporter({
    url: resolveLogsEndpoint(otelConfig),
    headers,
    timeoutMillis: 1000,
    compression: 'gzip',
  });

  const processor = new BatchLogRecordProcessor(logExporter);
  let provider;
  if (typeof LoggerProvider.prototype.addLogRecordProcessor === 'function') {
    provider = new LoggerProvider({ resource });
    provider.addLogRecordProcessor(processor);
  } else {
    provider = new LoggerProvider({ resource, logRecordProcessors: [processor] });
  }

  logs.setGlobalLoggerProvider(provider);
  logger = logs.getLogger(otelConfig.serviceName || 'otel-dynamodb-demo');

  return provider;
}

function emitLog(severityNumber, severityText, body, attributes) {
  const activeLogger = logger ?? logs.getLogger('otel-dynamodb-demo');
  activeLogger.emit({
    severityNumber,
    severityText,
    body,
    attributes,
  });
}

export function logInfo(message, attributes = {}) {
  console.log(message);
  emitLog(SeverityNumber.INFO, 'INFO', message, attributes);
}

export function logWarn(message, attributes = {}) {
  console.warn(message);
  emitLog(SeverityNumber.WARN, 'WARN', message, attributes);
}

export function logError(message, attributes = {}) {
  console.error(message);
  emitLog(SeverityNumber.ERROR, 'ERROR', message, attributes);
}

export function logDebug(message, attributes = {}) {
  if (!debugEnabled) {
    return;
  }
  console.debug(message);
  emitLog(SeverityNumber.DEBUG, 'DEBUG', message, attributes);
}
