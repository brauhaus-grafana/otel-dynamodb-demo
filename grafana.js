/* eslint-disable no-console */
/* eslint-disable import/first */

import {
  NodeTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  AlwaysOnSampler,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { AwsLambdaInstrumentation } from '@opentelemetry/instrumentation-aws-lambda';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  propagation,
} from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import {
  W3CTraceContextPropagator,
  CompositePropagator,
} from '@opentelemetry/core';
// Add URL for hostname parsing
import { URL } from 'url';

// Export initialization function that accepts config
export function initializeGrafana(otelConfig) {
  // Enable debug logging based on configuration

  const isDebugEnabled = otelConfig.debugEnabled;

  if (isDebugEnabled) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  // Parse OTEL service attributes
  const resourceAttributes = {};

  // Set service attributes using the standard attribute keys
  resourceAttributes[SEMRESATTRS_SERVICE_NAME] = otelConfig.serviceName;
  resourceAttributes['service.namespace'] = otelConfig.serviceNamespace;
  resourceAttributes['service.version'] = otelConfig.serviceVersion;
  resourceAttributes['deployment.environment'] = otelConfig.environment;

  // Create Resource with attributes
  const resource = new Resource(resourceAttributes);

  // Configure OTLP exporter
  const headers = {};
  if (otelConfig.exporterToken) {
    headers.Authorization = `Basic ${otelConfig.exporterToken}`;
  }

  const traceExporter = new OTLPTraceExporter({
    url: otelConfig.exporterEndpoint,
    headers,
    timeoutMillis: 1000, // 1000ms timeout for reliability
    compression: 'gzip', // Re-enabled: Essential for 100% sampling to reduce network latency
    // Re-enable keepAlive for performance, but use standard settings to avoid EBADF
    keepAlive: true,
    httpAgentOptions: {
      keepAlive: true,
      maxSockets: Infinity,
    },
  });

  // Wrap exporter to log export results
  const originalExport = traceExporter.export.bind(traceExporter);
  traceExporter.export = (spans, resultCallback) => {
    originalExport(spans, result => {
      if (result.code !== 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `⚠️ Export failed (connection retry may be needed in Lambda): Code: ${result.code}, Error: ${result.error ?? 'Unknown'}`
        );
      }
      resultCallback(result);
    });
  };




  // Create tracer provider with Resource
  const provider = new NodeTracerProvider({
    resource,
    // Force 100% sampling as requested
    sampler: new AlwaysOnSampler(),
  });

  // Use BatchSpanProcessor - single export at end
  // Grafana responds in 250ms, so total flush should be ~250-300ms
  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 2048, // Keep increased queue
    maxExportBatchSize: 500, // Single batch export
    scheduledDelayMillis: 60000, // No automatic exports - only on forceFlush
    exportTimeoutMillis: 1000, // Match flush timeout
  });

  provider.addSpanProcessor(spanProcessor);



  // Explicitly set W3C Trace Context propagator to ensure proper context propagation
  // This is critical when NewRelic is also enabled to prevent interference
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator()],
    })
  );

  provider.register();

  // Register instrumentations using registerInstrumentations()
  // This is the proper way to ensure instrumentation order and compatibility

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // HTTP instrumentation MUST be first to capture outgoing HTTP/HTTPS requests
      new HttpInstrumentation({
        // CRITICAL: Allow HTTP client spans without parent context
        // This ensures axios/http.request calls create spans even without active parent
        requireParentforOutgoingSpans: false,
        requireParentforIncomingSpans: false,
        ignoreOutgoingRequestHook: req => {
          const path = req.path ?? '';

          // Check if request matches configured exporter endpoint
          try {
            if (otelConfig.exporterEndpoint) {
              const exporterUrl = new URL(otelConfig.exporterEndpoint);
              // Check host header or properties which might be set
              const reqHost = req.host || req.hostname || req.getHeader?.('host');

              if (reqHost && (reqHost === exporterUrl.hostname || reqHost === exporterUrl.host)) {
                return true;
              }
            }
          } catch (e) {
            // ignore URL parsing errors
          }

          // General telemetry filtering list
          const ignoredHosts = [
            'collector.newrelic.com',
            'grafana.net',
            'launchdarkly.com',
          ];

          // Check against host/hostname
          const reqHost =
            req.host ?? req.hostname ?? req.getHeader?.('host') ?? '';
          if (reqHost && ignoredHosts.some(h => reqHost.includes(h))) {
            return true;
          }

          const shouldIgnore =
            path.includes('otlp') ||
            path.includes('v1/traces') ||
            path.includes('grafana.net') ||
            path.includes('newrelic'); // filter path as fallback

          return shouldIgnore;
        },
      }),

      // Express instrumentation for incoming HTTP requests
      new ExpressInstrumentation(),

      // Lambda instrumentation with custom hooks
      new AwsLambdaInstrumentation({
        disableAwsContextPropagation: false,
        requestHook: (span, { event, context }) => {
          // Add custom attributes from API Gateway event
          if (event.requestContext) {
            const route = event.path || event.requestContext.path || 'unknown';
            const method =
              event.httpMethod ||
              event.requestContext?.http?.method ||
              'UNKNOWN';

            span.setAttribute('http.route', route);
            span.setAttribute('http.method', method);

            // Update span name to include method and route
            span.updateName(`${method} ${route}`);

            if (event.requestContext.apiId) {
              span.setAttribute('faas.trigger', 'http');
            }
          }
          // Add Lambda execution ID from context
          if (context.awsRequestId) {
            span.setAttribute('faas.execution', context.awsRequestId);
          }
        },
      }),

      // AWS SDK instrumentation (DynamoDB, SNS, SQS, etc.) — exports spans to OTLP/Grafana
      new AwsInstrumentation({
        // Suppress underlying HTTP spans so only one span per AWS call (e.g. DynamoDB) is exported
        suppressInternalInstrumentation: true,
        // Enrich DynamoDB spans for better filtering in Grafana (table, operation)
        preRequestHook: (span, request) => {
          const service = request?.serviceId?.name ?? request?.service?.name;
          if (service === 'DynamoDB' && request?.commandName) {
            span.setAttribute('aws.dynamodb.operation', request.commandName);
            const input = request?.commandInput;
            let table = input?.TableName;
            if (!table && input?.RequestItems && typeof input.RequestItems === 'object') {
              table = Object.keys(input.RequestItems).join(',');
            }
            if (table && typeof table === 'string') {
              span.setAttribute('db.name', table);
            }
          }
        },
      }),
    ],
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    try {
      await provider.shutdown();
    } catch (error) {
      // Silently handle shutdown errors
    } finally {
      process.exit(0);
    }
  });

  // Return the provider so it can be used for flushing
  return provider;
}
