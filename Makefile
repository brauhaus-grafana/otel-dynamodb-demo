BUILD_STAMP := .docker-build-stamp

.PHONY: build start down clean setup-dynamodb cleanup-dynamodb help
build: $(BUILD_STAMP)

SOURCE_FILES := $(wildcard *.js)

$(BUILD_STAMP): Dockerfile package.json package-lock.json docker-compose.yaml $(SOURCE_FILES)
	docker compose build
	touch $(BUILD_STAMP)

start: $(BUILD_STAMP)
	docker compose up

down:
	docker compose down

clean: down cleanup-dynamodb
	docker compose rm -f -v
	docker rmi -f otel-dynamodb-demo 2>/dev/null || true
	rm -f $(BUILD_STAMP)

setup-dynamodb:
	./setup-dynamodb.sh

cleanup-dynamodb:
	@if [ -n "$$AWS_ACCESS_KEY_ID" ] || [ -n "$$AWS_PROFILE" ]; then \
		./cleanup-dynamodb.sh; \
	else \
		echo "Skipping cleanup-dynamodb (no AWS credentials detected)."; \
	fi

help:
	@printf "%s\n" \
		"Usage: make <target>" \
		"" \
		"Targets:" \
		"  build  Build the container image (if needed)" \
		"  start  Start the demo with docker compose" \
		"  down   Stop the compose services" \
		"  clean  Stop services, remove containers/images, and table" \
		"  setup-dynamodb  Create the DynamoDB table via AWS CLI" \
		"  cleanup-dynamodb  Delete the DynamoDB table via AWS CLI" \
		"  help   Show this help"
