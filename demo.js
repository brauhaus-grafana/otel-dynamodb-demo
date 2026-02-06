#!/usr/bin/env node
/**
 * Entry point: initialize OpenTelemetry first, then run DynamoDB demo.
 * Order is critical — tracing.js must run before DynamoDB client is loaded.
 */
import { logProvider, metricProvider, tracerProvider } from './tracing.js';
import { runDemo } from './demo-dynamodb.js';
import { logError, logInfo } from './logging.js';

const intervalMs = Number.parseInt(process.env.DEMO_INTERVAL_MS ?? '10000', 10);
const maxIterations = Number.parseInt(process.env.DEMO_ITERATIONS ?? '0', 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function flushTelemetry() {
  await tracerProvider.forceFlush();
  await metricProvider.forceFlush?.();
  await logProvider.forceFlush?.();
}

async function main() {
  logInfo('Starting DynamoDB OpenTelemetry demo');
  logInfo(
    `Looping with interval ${intervalMs}ms` +
      (maxIterations > 0 ? ` for ${maxIterations} iterations` : '')
  );

  let iteration = 0;
  while (maxIterations === 0 || iteration < maxIterations) {
    iteration += 1;
    try {
      await runDemo();
      await flushTelemetry();
      logInfo(`Iteration ${iteration} complete`);
    } catch (err) {
      logError(`Iteration ${iteration} failed: ${err?.message ?? err}`, {
        error: String(err),
      });
    }

    await sleep(intervalMs);
  }

  logInfo('Demo finished, flushing telemetry');
  await flushTelemetry();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logError(`Demo failed: ${err?.message ?? err}`, { error: String(err) });
    process.exit(1);
  });
