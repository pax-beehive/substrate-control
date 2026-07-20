// TypeScript types mirroring the Substrate Control REST API contract
// (see API_CONTRACT.md). All field names are camelCase, timestamps RFC3339.

export type ActorStatus =
  | "UNSPECIFIED"
  | "RESUMING"
  | "RUNNING"
  | "SUSPENDING"
  | "SUSPENDED"
  | "PAUSING"
  | "PAUSED"
  | "CRASHED"

export interface Atespace {
  name: string
  uid: string
  version: number
  createTime: string
  updateTime: string
}

export interface AtespaceList {
  atespaces: Atespace[] | null
}

export interface WorkerSelector {
  matchLabels?: Record<string, string> | null
}

export interface SnapshotInfo {
  type: string // "external" | "local"
  snapshotUriPrefix?: string // external only
  snapshotPrefix?: string // local only
  nodeVmsWithLocalSnapshots?: string[] // local only
}

export interface Actor {
  atespace: string
  name: string
  uid: string
  version: number
  createTime: string
  updateTime: string
  actorTemplateNamespace: string
  actorTemplateName: string
  status: ActorStatus
  ateomPodNamespace?: string
  ateomPodName?: string
  ateomPodIP?: string
  workerPoolName?: string
  workerSelector?: WorkerSelector | null
  snapshotInfo?: SnapshotInfo
}

export interface ActorList {
  actors: Actor[] | null
}

export interface CreateActorRequest {
  atespace: string
  name: string
  actorTemplateNamespace: string
  actorTemplateName: string
  workerSelector?: WorkerSelector
}

export interface ActorProxyRequest {
  method: "GET" | "POST"
  path: string
  body?: string
  contentType?: string
}

export interface ActorProxyResponse {
  status: number
  contentType: string
  body: string
}

export interface WorkerAssignment {
  actor: { atespace: string; name: string }
  actorTemplate: { namespace: string; name: string }
}

export interface Worker {
  workerNamespace: string
  workerPool: string
  workerPod: string
  ip: string
  version: number
  workerPodUid: string
  nodeName: string
  sandboxClass: string
  labels?: Record<string, string> | null
  assignment?: WorkerAssignment | null
}

export interface WorkerList {
  workers: Worker[] | null
}

export interface K8sObject {
  namespace: string
  name: string
  uid: string
  creationTimestamp: string
  labels?: Record<string, string>
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
}

export interface K8sObjectList {
  items: K8sObject[] | null
}

export interface CreateK8sObjectRequest {
  namespace: string
  name: string
  labels?: Record<string, string>
  spec: Record<string, unknown>
}

export interface SecretInfo {
  namespace: string
  name: string
  type: string
  keys: string[]
  creationTimestamp: string
}

export interface SecretList {
  items: SecretInfo[] | null
}

export interface CreateSecretRequest {
  namespace: string
  name: string
  data: Record<string, string>
}

// Gateway (LiteLLM proxy admin)

export interface GatewayInfo {
  reachable: boolean
  url: string
  version: string
}

export interface GatewayKey {
  key: string
  keyAlias: string
  models?: string[] | null
  spend: number
  maxBudget: number
  expires?: string
  createdAt?: string
  userId?: string
}

export interface GatewayKeyList {
  items: GatewayKey[] | null
}

export interface GenerateKeyRequest {
  keyAlias: string
  duration?: string
  models?: string[]
  maxBudget?: number
}

export interface GeneratedKey {
  key: string
  keyAlias: string
  duration?: string
  expires?: string
}

export interface GatewayModel {
  id: string
  modelName: string
  model: string
  provider: string
  apiBase?: string
  hasApiKey: boolean
  createdAt?: string
  updatedAt?: string
}

export interface GatewayModelList {
  items: GatewayModel[] | null
}

export interface RegisterModelRequest {
  modelName: string
  model: string
  apiKey: string
  apiBase?: string
  extraParams?: Record<string, unknown>
}

// Monitoring

export interface NodeMetrics {
  name: string
  cpuUsage: string
  cpuPercent: number
  memoryUsage: string
  memoryPercent: number
}

export interface NodeMetricsSection {
  available: boolean
  items: NodeMetrics[] | null
}

export interface NamespacePodMetrics {
  namespace: string
  podCount: number
  cpuUsage: string
  memoryUsage: string
}

export interface PodMetricsSection {
  available: boolean
  items: NamespacePodMetrics[] | null
}

export interface SubstrateMetrics {
  workersTotal: number
  workersAssigned: number
  workersIdle: number
  actorsRunning: number
  actorsSuspended: number
  actorsTransitioning: number
  actorsCrashed: number
  pools: number
  templates: number
  atespaces: number
}

export interface TokenTotals {
  prompt: number
  completion: number
  total: number
}

export interface KeySpend {
  keyAlias: string
  keyName: string
  spend: number
  tokens: number
  requests: number
}

export interface ModelSpend {
  model: string
  spend: number
  tokens: number
  requests: number
}

export interface GatewayMetrics {
  reachable: boolean
  totalSpend: number
  maxBudget: number
  totalRequests: number
  tokens: TokenTotals
  spendByKey: KeySpend[] | null
  spendByModel: ModelSpend[] | null
}

export interface MonitoringOverview {
  nodes: NodeMetricsSection
  pods: PodMetricsSection
  substrate: SubstrateMetrics
  gateway: GatewayMetrics
}

export interface SpendLog {
  requestId: string
  startTime: string
  endTime: string
  model: string
  keyAlias: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  spend: number
}

export interface SpendLogList {
  items: SpendLog[] | null
}
