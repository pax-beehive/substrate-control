import type {
  Actor,
  ActorList,
  ActorProxyRequest,
  ActorProxyResponse,
  Atespace,
  AtespaceList,
  CreateActorRequest,
  CreateK8sObjectRequest,
  CreateSecretRequest,
  GenerateKeyRequest,
  GeneratedKey,
  GatewayInfo,
  GatewayKeyList,
  GatewayModel,
  GatewayModelList,
  K8sObject,
  K8sObjectList,
  MonitoringOverview,
  RegisterModelRequest,
  SecretInfo,
  SecretList,
  SpendLogList,
  WorkerList,
} from "./types"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body: unknown = await res.json()
      if (
        body !== null &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
      ) {
        message = (body as { error: string }).error
      }
    } catch {
      // no JSON body — keep the HTTP status message
    }
    throw new ApiError(res.status, message)
  }

  return (await res.json()) as T
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

// Atespaces

export function listAtespaces(): Promise<AtespaceList> {
  return request("/atespaces")
}

export function createAtespace(name: string): Promise<Atespace> {
  return request("/atespaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  })
}

export function deleteAtespace(name: string): Promise<Atespace> {
  return request(`/atespaces/${seg(name)}`, { method: "DELETE" })
}

// Actors

export function listActors(atespace?: string): Promise<ActorList> {
  const query = atespace ? `?atespace=${encodeURIComponent(atespace)}` : ""
  return request(`/actors${query}`)
}

export function getActor(atespace: string, name: string): Promise<Actor> {
  return request(`/actors/${seg(atespace)}/${seg(name)}`)
}

export function createActor(req: CreateActorRequest): Promise<Actor> {
  return request("/actors", { method: "POST", body: JSON.stringify(req) })
}

export function deleteActor(atespace: string, name: string): Promise<Actor> {
  return request(`/actors/${seg(atespace)}/${seg(name)}`, { method: "DELETE" })
}

export function suspendActor(
  atespace: string,
  name: string,
): Promise<{ actor: Actor }> {
  return request(`/actors/${seg(atespace)}/${seg(name)}/suspend`, {
    method: "POST",
  })
}

export function pauseActor(
  atespace: string,
  name: string,
): Promise<{ actor: Actor }> {
  return request(`/actors/${seg(atespace)}/${seg(name)}/pause`, {
    method: "POST",
  })
}

export function resumeActor(
  atespace: string,
  name: string,
  boot: boolean,
): Promise<{ actor: Actor }> {
  return request(`/actors/${seg(atespace)}/${seg(name)}/resume`, {
    method: "POST",
    body: JSON.stringify({ boot }),
  })
}

export function proxyActorRequest(
  atespace: string,
  name: string,
  req: ActorProxyRequest,
): Promise<ActorProxyResponse> {
  return request(`/actors/${seg(atespace)}/${seg(name)}/proxy`, {
    method: "POST",
    body: JSON.stringify(req),
  })
}

// Workers

export function listWorkers(): Promise<WorkerList> {
  return request("/workers")
}

// Kubernetes CRDs (may 503 when the backend lacks cluster access)

export function listActorTemplates(): Promise<K8sObjectList> {
  return request("/actortemplates")
}

export function createActorTemplate(
  req: CreateK8sObjectRequest,
): Promise<K8sObject> {
  return request("/actortemplates", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function deleteActorTemplate(
  namespace: string,
  name: string,
): Promise<{ deleted: boolean }> {
  return request(`/actortemplates/${seg(namespace)}/${seg(name)}`, {
    method: "DELETE",
  })
}

// Secrets (k8s core/v1; values are write-only and never returned)

export function listSecrets(namespace: string): Promise<SecretList> {
  return request(`/secrets?namespace=${encodeURIComponent(namespace)}`)
}

export function createSecret(req: CreateSecretRequest): Promise<SecretInfo> {
  return request("/secrets", { method: "POST", body: JSON.stringify(req) })
}

export function deleteSecret(
  namespace: string,
  name: string,
): Promise<{ deleted: boolean }> {
  return request(`/secrets/${seg(namespace)}/${seg(name)}`, {
    method: "DELETE",
  })
}

// Gateway (LiteLLM proxy admin; 503 when unconfigured/unreachable)

export function getGatewayInfo(): Promise<GatewayInfo> {
  return request("/gateway/info")
}

export function listGatewayKeys(): Promise<GatewayKeyList> {
  return request("/gateway/keys")
}

export function generateGatewayKey(
  req: GenerateKeyRequest,
): Promise<GeneratedKey> {
  return request("/gateway/keys", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function deleteGatewayKey(key: string): Promise<{ deleted: boolean }> {
  return request(`/gateway/keys/${seg(key)}`, { method: "DELETE" })
}

export function listGatewayModels(): Promise<GatewayModelList> {
  return request("/gateway/models")
}

export function registerGatewayModel(
  req: RegisterModelRequest,
): Promise<GatewayModel> {
  return request("/gateway/models", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function deleteGatewayModel(id: string): Promise<{ deleted: boolean }> {
  return request(`/gateway/models/${seg(id)}`, { method: "DELETE" })
}

// WorkerPools

export function listWorkerPools(): Promise<K8sObjectList> {
  return request("/workerpools")
}

export function createWorkerPool(
  req: CreateK8sObjectRequest,
): Promise<K8sObject> {
  return request("/workerpools", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function deleteWorkerPool(
  namespace: string,
  name: string,
): Promise<{ deleted: boolean }> {
  return request(`/workerpools/${seg(namespace)}/${seg(name)}`, {
    method: "DELETE",
  })
}

// Monitoring

export function getMetricsOverview(): Promise<MonitoringOverview> {
  return request("/metrics/overview")
}

export function getSpendLogs(limit: number): Promise<SpendLogList> {
  return request(`/metrics/spendlogs?limit=${limit}`)
}
