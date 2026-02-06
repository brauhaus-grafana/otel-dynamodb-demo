# OpenTelemetry + DynamoDB Demo

Demo application that performs AWS DynamoDB operations (PutItem, GetItem, Scan) with **OpenTelemetry** instrumentation. All DynamoDB calls are traced and can be exported to Grafana Tempo or any OTLP backend.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

   If you plan to run via Docker/Make, you can skip `npm install` and build the container instead:

   ```bash
   make build
   ```

2. **AWS credentials** (for real AWS or LocalStack):  
   Configure as usual (e.g. `aws configure`, env vars `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, or IAM role).

3. **DynamoDB table** (one of):

   - **AWS**: Create a table in your account with partition key `id` (String).  
   - **LocalStack**: Run DynamoDB locally and create the table.  
   - **DynamoDB Local**: Use the [NoSQL Workbench](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/workbench.html) or DynamoDB Local Docker image.

  You can create the table with `make setup-dynamodb`, or use the AWS CLI (after credentials are set):

   ```bash
   aws dynamodb create-table \
     --table-name otel-demo-items \
     --attribute-definitions AttributeName=id,AttributeType=S \
     --key-schema AttributeName=id,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST
   ```

   Or:

   ```bash
   make setup-dynamodb
   ```

   To delete the table:

   ```bash
   make cleanup-dynamodb
   ```

## Run the demo

Via Docker + Make:

```bash
cp .env.example .env
${EDITOR:-vi} .env
make build
make start
```

Cleanup:

```bash
make down
make clean
```

Or run locally:

```bash
npm run demo
```

Or with env vars:

```bash
DYNAMODB_TABLE=otel-demo-items \
AWS_REGION=us-east-1 \
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway.example.com/v1/traces \
OTEL_SERVICE_NAME=my-demo \
npm run demo
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DYNAMODB_TABLE` / `TABLE_NAME` | `otel-demo-items` | DynamoDB table name (partition key `id`). |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | `us-east-1` | AWS region. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP trace endpoint (Grafana, Jaeger, etc.). |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `http://localhost:4318/v1/logs` | OTLP logs endpoint. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `http://localhost:4318/v1/metrics` | OTLP metrics endpoint. |
| `OTEL_SERVICE_NAME` | `otel-dynamodb-demo` | Service name in traces. |
| `GRAFANA_OTLP_ENDPOINT` | — | Grafana Cloud OTLP endpoint for Alloy (host:port). |
| `GRAFANA_OTLP_USERNAME` | — | Grafana Cloud OTLP username for Alloy. |
| `GRAFANA_OTLP_API_KEY` | — | Grafana Cloud API key for Alloy. |
| `OTEL_DEBUG` | `false` | Set to `true` for OpenTelemetry debug logs. |

## What gets traced and measured

- **PutItem** — span with `aws.dynamodb.operation`, `db.name` (table).
- **GetItem** — same attributes.
- **Scan** — same attributes.
- **Metrics** — per-operation count, error count, and duration histogram.

Instrumentation is provided by `grafana.js` via `@opentelemetry/instrumentation-aws-sdk` (AWS SDK v3). The demo loads `tracing.js` first so the DynamoDB client is patched before use.

## Viewing traces and logs

When using Docker Compose, telemetry is sent to Grafana Alloy first and then forwarded to Grafana Cloud. Alloy also exposes a local UI at `http://localhost:12345` for live debugging.

- **Grafana Cloud**: Set `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_USERNAME`, and `GRAFANA_OTLP_API_KEY` in `.env` for Alloy to forward to Grafana Cloud.
- **Local OTLP collector**: Point `OTEL_EXPORTER_OTLP_ENDPOINT`/`_LOGS_ENDPOINT`/`_METRICS_ENDPOINT` at your collector instead of Alloy if desired.

## Documentation

- **OpenTelemetry JS**: https://opentelemetry.io/docs/languages/js/
- **OTLP exporter configuration**: https://opentelemetry.io/docs/concepts/sdk-configuration/otlp-exporter-configuration/
- **Grafana Alloy**: https://grafana.com/docs/alloy/latest/
- **Grafana Cloud OTLP ingest**: https://grafana.com/docs/grafana-cloud/send-data/otlp/
- **Grafana Cloud OTLP (production)**: https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/ (recommends Grafana Alloy for production environments)
