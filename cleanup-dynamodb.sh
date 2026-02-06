#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

TABLE_NAME="${DYNAMODB_TABLE:-otel-demo-items}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
AWS_CLI_ARGS=(--region "${REGION}")
if [ -n "${AWS_PROFILE:-}" ]; then
  AWS_CLI_ARGS+=(--profile "${AWS_PROFILE}")
fi

if [ -z "${AWS_PROFILE:-}" ]; then
  if [ "${AWS_ACCESS_KEY_ID:-}" = "your_access_key_id_here" ] || \
     [ "${AWS_SECRET_ACCESS_KEY:-}" = "your_secret_access_key_here" ]; then
    echo "Error: AWS credentials in ${ENV_FILE} are still placeholders." >&2
    echo "Update AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or set AWS_PROFILE." >&2
    exit 1
  fi

  if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    echo "Error: AWS credentials are missing." >&2
    echo "Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE and retry." >&2
    exit 1
  fi

  if [ "${AWS_GET_SESSION_TOKEN:-false}" = "true" ] && [ -z "${AWS_SESSION_TOKEN:-}" ]; then
    echo "Fetching temporary AWS session token..."
    SESSION_ARGS=("${AWS_CLI_ARGS[@]}")
    if [ -n "${AWS_MFA_SERIAL:-}" ] && [ -n "${AWS_MFA_TOKEN_CODE:-}" ]; then
      SESSION_ARGS+=(--serial-number "${AWS_MFA_SERIAL}" --token-code "${AWS_MFA_TOKEN_CODE}")
    fi

    read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN < <(
      aws sts get-session-token \
        "${SESSION_ARGS[@]}" \
        --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
        --output text
    )
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  fi
fi

echo "Checking AWS credentials..."
if [ "${AWS_SKIP_CREDENTIALS_CHECK:-false}" != "true" ]; then
  STS_OUTPUT=""
  if ! STS_OUTPUT=$(aws sts get-caller-identity "${AWS_CLI_ARGS[@]}" 2>&1); then
    case "${STS_OUTPUT}" in
      *AccessDenied*|*UnauthorizedOperation*|*not\ authorized\ to\ perform:\ sts:GetCallerIdentity*)
        echo "Warning: sts:GetCallerIdentity is not permitted; continuing." >&2
        ;;
      *)
        echo "Error: AWS credentials are invalid or missing." >&2
        echo "Fix AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, or AWS_PROFILE and retry." >&2
        exit 1
        ;;
    esac
  else
    echo "AWS credentials are valid."
  fi
else
  echo "Skipping AWS credential validation (AWS_SKIP_CREDENTIALS_CHECK=true)."
fi

echo "Deleting DynamoDB table: ${TABLE_NAME} (region: ${REGION})"
if ! aws dynamodb delete-table --table-name "${TABLE_NAME}" "${AWS_CLI_ARGS[@]}" --output json 2>/dev/null; then
  echo "Table does not exist or cannot be deleted. Skipping." >&2
  exit 0
fi

echo "Waiting for table to be deleted..."
aws dynamodb wait table-not-exists --table-name "${TABLE_NAME}" "${AWS_CLI_ARGS[@]}"

echo "Done."
