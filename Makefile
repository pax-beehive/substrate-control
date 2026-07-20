PROTOC ?= protoc
GOBIN_LOCAL := $(CURDIR)/bin

.PHONY: proto build run tools tidy image

# Install the protoc Go plugins locally into ./bin (kept inside the project).
tools:
	GOBIN=$(GOBIN_LOCAL) go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	GOBIN=$(GOBIN_LOCAL) go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Generate Go code from the vendored ateapi.proto into gen/ateapipb,
# overriding the upstream go_package with our module path.
proto:
	mkdir -p gen
	PATH=$(GOBIN_LOCAL):$$PATH $(PROTOC) \
		--proto_path=proto \
		--go_out=gen --go_opt=paths=source_relative \
		--go_opt=Mateapipb/ateapi.proto=substrate-control/gen/ateapipb \
		--go-grpc_out=gen --go-grpc_opt=paths=source_relative \
		--go-grpc_opt=Mateapipb/ateapi.proto=substrate-control/gen/ateapipb \
		ateapipb/ateapi.proto

build:
	go build -o bin/server ./cmd/server

run: build
	./bin/server

tidy:
	go mod tidy

# Build the in-cluster distribution image (frontend + embedded backend).
image:
	docker buildx build --platform linux/amd64 -t substrate-control:dev --load .
