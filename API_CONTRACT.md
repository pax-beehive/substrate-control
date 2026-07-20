# Substrate Control — Backend REST API Contract

The Go backend exposes this JSON REST API and also serves the built frontend
statically. All JSON field names are camelCase. All timestamps are RFC3339
strings. Errors are returned as `{"error": "<message>"}` with an appropriate
HTTP status code.

Base path: `/api`

## Atespaces

- `GET /api/atespaces` → `AtespaceList`
- `POST /api/atespaces` body: `{ "name": "my-space" }` → `Atespace`
- `DELETE /api/atespaces/{name}` → `Atespace` (the deleted object)

```jsonc
// Atespace
{ "name": "my-space", "uid": "...", "version": 1, "createTime": "...", "updateTime": "..." }
// AtespaceList
{ "atespaces": [Atespace] }
```

## Actors

- `GET /api/actors?atespace=<name>` (query optional; empty = all atespaces) → `ActorList`
- `POST /api/actors` body: `CreateActorRequest` → `Actor`
- `GET /api/actors/{atespace}/{name}` → `Actor`
- `DELETE /api/actors/{atespace}/{name}` → `Actor`
- `POST /api/actors/{atespace}/{name}/suspend` → `{ "actor": Actor }`
- `POST /api/actors/{atespace}/{name}/pause` → `{ "actor": Actor }`
- `POST /api/actors/{atespace}/{name}/resume` body: `{ "boot": false }` → `{ "actor": Actor }`
- `PATCH /api/actors/{atespace}/{name}` body: `{ "workerSelector": { "matchLabels": {"k":"v"} } }` → `{ "actor": Actor }`
- `POST /api/actors/{atespace}/{name}/proxy` body: `ActorProxyRequest` → `ActorProxyResponse`

```jsonc
// ActorProxyRequest — sent to the actor through the atenet router with
// Host: <name>.<atespace>.actors.resources.substrate.ate.dev
{ "method": "GET" | "POST", "path": "/ask", "body": "...", "contentType": "text/plain" }

// ActorProxyResponse — upstream response relayed verbatim
{ "status": 200, "contentType": "text/plain; charset=utf-8", "body": "..." }
```

```jsonc
// CreateActorRequest
{
  "atespace": "my-space",
  "name": "my-actor",
  "actorTemplateNamespace": "ate-demo-counter",
  "actorTemplateName": "counter",
  "workerSelector": { "matchLabels": { "k": "v" } } // optional
}

// Actor
{
  "atespace": "my-space", "name": "my-actor", "uid": "...", "version": 3,
  "createTime": "...", "updateTime": "...",
  "actorTemplateNamespace": "ate-demo-counter", "actorTemplateName": "counter",
  "status": "RUNNING", // one of UNSPECIFIED RESUMING RUNNING SUSPENDING SUSPENDED PAUSING PAUSED CRASHED
  "ateomPodNamespace": "...", "ateomPodName": "...", "ateomPodIP": "...",
  "workerPoolName": "...",
  "workerSelector": { "matchLabels": { "k": "v" } }, // may be omitted/null
  "snapshotInfo": { // optional, omitted when absent
    "type": "external", // or "local"
    "snapshotUriPrefix": "...",     // external only
    "snapshotPrefix": "...",        // local only
    "nodeVmsWithLocalSnapshots": [] // local only
  }
}
// ActorList
{ "actors": [Actor] }
```

## Workers

- `GET /api/workers` → `WorkerList`

```jsonc
// Worker
{
  "workerNamespace": "...", "workerPool": "...", "workerPod": "...",
  "ip": "...", "version": 1, "workerPodUid": "...", "nodeName": "...",
  "sandboxClass": "...", "labels": { "k": "v" },
  "assignment": { // omitted/null when idle
    "actor": { "atespace": "...", "name": "..." },
    "actorTemplate": { "namespace": "...", "name": "..." }
  }
}
// WorkerList
{ "workers": [Worker] }
```

## Kubernetes CRDs (via client-go dynamic client)

- `GET /api/actortemplates` → `{ "items": [K8sObject] }`
- `POST /api/actortemplates` body: `CreateK8sObjectRequest` → created `K8sObject`
- `DELETE /api/actortemplates/{namespace}/{name}` → `{ "deleted": true }` (404 when absent)
- `GET /api/workerpools` → `{ "items": [K8sObject] }`
- `POST /api/workerpools` body: `CreateK8sObjectRequest` → created `K8sObject`
- `DELETE /api/workerpools/{namespace}/{name}` → `{ "deleted": true }` (404 when absent)

```jsonc
// CreateK8sObjectRequest — spec is passed through to the CRD unchanged.
// Server sets only apiVersion/kind/metadata.{namespace,name,labels}.
// (WorkerPool = `workerpools.ate.dev/v1alpha1`; spec requires `ateomImage` + `replicas`.)
{
  "namespace": "ate-demo-counter",
  "name": "counter",
  "labels": { "k": "v" }, // optional — WorkerPool labels are what ActorTemplate workerSelector matches
  "spec": { ... }         // raw spec, required
}
```

```jsonc
// K8sObject (flattened, unstructured-derived)
{
  "namespace": "...", "name": "...", "uid": "...",
  "creationTimestamp": "...",
  "labels": { "k": "v" },           // may be omitted
  "spec": { ... },                  // raw spec object, passed through
  "status": { ... }                 // raw status object, may be omitted
}
```

## Gateway (LiteLLM proxy admin; master key stays server-side, injected by the backend)

Backend proxies these to the LiteLLM instance (`LITELLM_URL`, default
`http://100.125.72.76:31358/litellm`) with `Authorization: Bearer <master-key>`.
Master key resolution: env `LITELLM_MASTER_KEY`, else read k8s secret
`litellm/litellm-secrets` key `master-key`. 503 with a clear message when the
gateway is unconfigured/unreachable.

- `GET /api/gateway/info` → `{ "reachable": true, "url": "http://...", "version": "x.y.z" }`
- `GET /api/gateway/keys` → `{ "items": [GatewayKey] }`
- `POST /api/gateway/keys` body: `GenerateKeyRequest` → `GeneratedKey` (the plaintext key is returned ONLY here, once)
- `DELETE /api/gateway/keys/{key}` → `{ "deleted": true }` (proxies LiteLLM `POST /key/delete`)
- `GET /api/gateway/models` → `{ "items": [GatewayModel] }` (proxies LiteLLM `GET /v2/model/info`; any `api_key`/credential fields in `litellm_params` MUST be redacted server-side)
- `POST /api/gateway/models` body: `RegisterModelRequest` → `GatewayModel` (proxies LiteLLM `POST /model/new`)
- `DELETE /api/gateway/models/{id}` → `{ "deleted": true }` (proxies LiteLLM `POST /model/delete` with the DB model id)

```jsonc
// GatewayModel — upstream provider credentials are NEVER returned
{
  "id": "db-model-uuid",
  "modelName": "claude-sonnet",                 // public alias workloads call
  "model": "anthropic/claude-sonnet-4-5",       // litellm_params.model
  "provider": "anthropic",                       // derived: prefix before the first "/"
  "apiBase": "https://...",                      // optional, omitted when unset
  "hasApiKey": true,
  "createdAt": "...", "updatedAt": "..."         // when LiteLLM provides them
}

// RegisterModelRequest
{
  "modelName": "claude-sonnet",                  // required
  "model": "anthropic/claude-sonnet-4-5",        // required, litellm provider/model string
  "apiKey": "sk-ant-...",                        // required, write-only
  "apiBase": "",                                 // optional
  "extraParams": { "rpm": 60 }                   // optional, merged into litellm_params
}
```

```jsonc
// GatewayKey (normalized from LiteLLM /key/list entries)
{
  "key": "sk-...redacted-or-hashed-as-returned",
  "keyAlias": "agent-luna", "models": ["claude-sonnet-4"],
  "spend": 0.0, "maxBudget": 10.0,
  "expires": "...", "createdAt": "...", "userId": "..."
}

// GenerateKeyRequest
{ "keyAlias": "agent-luna", "duration": "7d", "models": [], "maxBudget": 0 } // models empty = all; maxBudget 0 = unset

// GeneratedKey (passthrough of LiteLLM /key/generate essentials)
{ "key": "sk-plaintext-shown-once", "keyAlias": "agent-luna", "duration": "7d", "expires": "..." }
```

## Monitoring (aggregates k8s metrics.k8s.io + substrate gRPC + LiteLLM admin API)

- `GET /api/metrics/overview` → `MonitoringOverview`
- `GET /api/metrics/spendlogs?limit=100` (limit optional, default 100, max 500) → `{ "items": [SpendLog] }`

```jsonc
// MonitoringOverview
{
  "nodes": {                          // from metrics.k8s.io; available=false when metrics-server missing
    "available": true,
    "items": [{ "name": "...", "cpuUsage": "2951m", "cpuPercent": 18.4, "memoryUsage": "17.1Gi", "memoryPercent": 57.2 }]
  },
  "pods": {                           // pod usage aggregated per namespace
    "available": true,
    "items": [{ "namespace": "ate-system", "podCount": 12, "cpuUsage": "50m", "memoryUsage": "800Mi" }]
  },
  "substrate": {                      // from gRPC ListWorkers/ListActors/ListAtespaces + k8s CRD lists
    "workersTotal": 3, "workersAssigned": 1, "workersIdle": 2,
    "actorsRunning": 1, "actorsSuspended": 2, "actorsTransitioning": 0, "actorsCrashed": 0,
    "pools": 2, "templates": 2, "atespaces": 1
  },
  "gateway": {                        // from LiteLLM; reachable=false when unconfigured/down
    "reachable": true,
    "totalSpend": 0.0, "maxBudget": 0.0,                       // GET /global/spend
    "totalRequests": 12,                                        // count of spend logs in window
    "tokens": { "prompt": 0, "completion": 0, "total": 0 },     // summed over spend logs
    "spendByKey": [{ "keyAlias": "agent-python", "keyName": "sk-...hZYA", "spend": 0.0, "tokens": 0, "requests": 0 }],
    "spendByModel": [{ "model": "claude-sonnet", "spend": 0.0, "tokens": 0, "requests": 0 }]
  }
}

// SpendLog (normalized from LiteLLM /spend/logs; api_key hash joined to alias via /global/spend/keys)
{
  "requestId": "...", "startTime": "...", "endTime": "...",
  "model": "claude-sonnet", "keyAlias": "agent-python",       // keyAlias "" when unmapped
  "promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "spend": 0.0
}
```- `GET /api/secrets?namespace=<ns>` (namespace required, 400 if missing) → `{ "items": [SecretInfo] }`
- `POST /api/secrets` body: `CreateSecretRequest` → created `SecretInfo`
- `DELETE /api/secrets/{namespace}/{name}` → `{ "deleted": true }` (404 when absent)

```jsonc
// SecretInfo
{ "namespace": "...", "name": "...", "type": "Opaque", "keys": ["api-key"], "creationTimestamp": "..." }

// CreateSecretRequest (always type Opaque; server maps data → stringData)
{ "namespace": "...", "name": "anthropic-api-key", "data": { "api-key": "sk-ant-..." } }
```

## Ops

- `GET /api/healthz` → `{ "ok": true }` (also verifies gRPC connectivity)
