/**
 * DynamoDB demo — PutItem, GetItem, and Scan.
 * All calls are automatically traced by OpenTelemetry (AwsInstrumentation).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { logDebug, logError, logInfo } from './logging.js';
import { getMeter } from './metrics.js';

const tableName =
  process.env.DYNAMODB_TABLE || process.env.TABLE_NAME || 'otel-demo-items';
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

const client = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(client);
const meter = getMeter();
const operationCounter = meter.createCounter('dynamodb.operation.count', {
  description: 'Number of DynamoDB operations performed',
});
const errorCounter = meter.createCounter('dynamodb.operation.error.count', {
  description: 'Number of DynamoDB operations that failed',
});
const durationHistogram = meter.createHistogram('dynamodb.operation.duration.ms', {
  description: 'DynamoDB operation duration in milliseconds',
  unit: 'ms',
});

async function recordOperation(operationName, action) {
  const start = Date.now();
  try {
    const result = await action();
    const durationMs = Date.now() - start;
    operationCounter.add(1, { operation: operationName, table: tableName });
    durationHistogram.record(durationMs, { operation: operationName, table: tableName });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    errorCounter.add(1, { operation: operationName, table: tableName });
    durationHistogram.record(durationMs, {
      operation: operationName,
      table: tableName,
      error: true,
    });
    throw err;
  }
}

export async function runDemo() {
  logInfo('DynamoDB demo (OpenTelemetry instrumented)');
  logInfo(`  Table: ${tableName}`);
  logInfo(`  Region: ${region}`);
  logInfo('');

  const id = `item-${Date.now()}`;
  const value = { message: 'Hello from OTel demo', ts: new Date().toISOString() };
  logDebug(`Generated item id: ${id}`);

  try {
    // PutItem — creates a span (e.g. PutItem)
    logInfo('1. PutItem');
    await recordOperation('PutItem', () =>
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { id, ...value },
        })
      )
    );
    logInfo('   OK');

    // GetItem — creates a span (e.g. GetItem)
    logInfo('2. GetItem');
    const getResult = await recordOperation('GetItem', () =>
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { id },
        })
      )
    );
    if (getResult.Item) {
      logDebug(`   Item: ${JSON.stringify(getResult.Item, null, 2)}`);
      logInfo('   Item retrieved');
    } else {
      logInfo('   (no item found)');
    }

    // Scan — creates a span (e.g. Scan), limit 5 for demo
    logInfo('3. Scan (limit 5)');
    const scanResult = await recordOperation('Scan', () =>
      docClient.send(
        new ScanCommand({
          TableName: tableName,
          Limit: 5,
        })
      )
    );
    const count = scanResult.Count ?? 0;
    const items = scanResult.Items ?? [];
    logInfo(`   Scanned ${count} item(s)`);
    logDebug(`   Items: ${items.length ? JSON.stringify(items) : '(none)'}`);
  } catch (err) {
    logError(`DynamoDB error: ${err?.message ?? err}`, { error: String(err) });
    if (err.name === 'ResourceNotFoundException') {
      logInfo(
        `   Create a table named "${tableName}" with partition key "id" (String) or set DYNAMODB_TABLE.`
      );
    }
    throw err;
  }

  logInfo('');
  logInfo('Done. Check your Grafana/Tempo or OTLP collector for DynamoDB spans.');
}
