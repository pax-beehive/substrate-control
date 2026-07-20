# syntax=docker/dockerfile:1

# Stage 1: build the frontend bundle.
FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: build the backend, embedding the fresh frontend bundle.
FROM golang:1.26 AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Replace the committed placeholder with the real dist for go:embed.
COPY --from=frontend /app/frontend/dist ./internal/web/dist
RUN CGO_ENABLED=0 go build -o /server ./cmd/server

# Stage 3: minimal runtime.
FROM gcr.io/distroless/static:nonroot
COPY --from=backend /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
