# Substrate Control

[Agent Substrate](https://github.com/agent-substrate/substrate) 的 Web 控制台：Actor 生命周期管理、Worker/WorkerPool/ActorTemplate（CRD）管理、LLM 网关（LiteLLM）虚拟 key 与上游模型管理、Secret 管理，以及向 Actor 直接下发任务的 Task 面板。

## 架构

```
浏览器 (React SPA)
   │  /api/* JSON
   ▼
Go 后端 (cmd/server)
   ├─ gRPC ──► ate-api-server（kubectl port-forward + SA token 自动刷新，默认模式）
   ├─ k8s API ──► ActorTemplate / WorkerPool CRD、Secret（client-go dynamic client）
   ├─ HTTP ──► LiteLLM 网关（master key 从集群 Secret 读取，不过浏览器）
   └─ HTTP ──► atenet-router（经 traefik ingress，代发 actor 流量）
```

- 后端默认 **portforward 模式**：自动管理 `kubectl port-forward` 到 `deploy/ate-api-server`（断了自动重连），用 `kubectl create token` 铸 SA token（1h，80% 生命周期刷新，Unauthenticated 时强制刷新重试一次）
- 显式设置 `SUBSTRATE_GRPC_ADDR` 则切回**直连模式**（无认证，用于调试）
- 前端 dev server（Vite, :5173）代理 `/api` 到 :8080；生产模式后端直接托管 `frontend/dist`

## 安装（任意 Substrate 集群）

控制台以 Deployment 形式部署进目标集群（ADR-0002）：

```bash
# 1. 构建并推送镜像到你的 registry（或使用已发布镜像替换 deploy 中的 image）
docker buildx build --platform linux/amd64 -t <your-registry>/substrate-control:latest --push .

# 2. 如使用自建 registry，修改 deploy/kustomization.yaml 的 images
# 3. 部署（幂等，可重复执行）
kubectl apply -k deploy/
```

部署后后端自动检测集群内环境（incluster 模式）：直连 `api.ate-system.svc:443`，用投影的 ServiceAccount token（audience `api.ate-system.svc`）认证；RBAC 为最小必要（见 `deploy/rbac.yaml`，secrets 为 cluster 级——见 ADR-0002 的妥协说明）。访问方式：

```bash
kubectl port-forward -n substrate-control svc/substrate-control 8080:8080   # → http://localhost:8080
```

生产暴露自行选择 ingress（`deploy/kustomization.yaml` 顶部有说明）。LiteLLM / metrics-server 缺失时对应页面区块自动降级，核心功能不受影响。

## 本地开发

```bash
# 前置：kubeconfig 指向目标集群（context microk8s）

make build        # 构建后端 bin/server + 前端 dist
make run          # http://localhost:8080（生产模式，单端口）

# 开发模式（两个终端）
./bin/server                    # 后端 :8080
cd frontend && npm run dev      # 前端 :5173（热更新）
```

## 页面

| 页面 | 功能 |
|---|---|
| Actors | 列表/详情/创建、suspend/resume（含 cold boot）/pause/delete、**Task 面板**（直接向 actor 发 HTTP 请求下任务） |
| Workers | 物理 worker 列表（total/assigned/idle 统计） |
| Monitoring | 聚合监控：节点/pod CPU 内存（metrics-server）、substrate 计数、LiteLLM spend/token 用量、最近请求日志 |
| Templates | ActorTemplate 创建（表单/YAML，harness 预设 Claude Code、Codex）/删除/详情 |
| Worker Pools | WorkerPool 创建（labels 与模板 workerSelector 对接）/删除/详情 |
| Secrets | k8s Opaque secret 管理（值只写不回显） |
| Gateway | LiteLLM 管理：Virtual Keys（签发/删除/一键存成 k8s Secret）、Models（注册上游平台模型，apiKey 加密落盘） |
| Atespaces | atespace 增删查 |

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | HTTP 监听 |
| `SUBSTRATE_GRPC_ADDR` | 空 | 设置后启用直连模式（跳过 port-forward/auth） |
| `SUBSTRATE_PF_NAMESPACE` / `SUBSTRATE_PF_TARGET` / `SUBSTRATE_PF_LOCAL_PORT` | `ate-system` / `deploy/ate-api-server` / `18443` | port-forward 参数 |
| `SUBSTRATE_SA` / `SUBSTRATE_SA_NAMESPACE` / `SUBSTRATE_TOKEN_AUDIENCE` | `ate-api-server` / `ate-system` / `api.ate-system.svc` | SA token 参数 |
| `SUBSTRATE_ROUTER_ADDR` | `http://100.125.72.76:31358` | actor 流量入口（Task 面板代理目标） |
| `LITELLM_URL` | `http://100.125.72.76:31358/litellm` | LiteLLM 管理面地址 |
| `LITELLM_MASTER_KEY` | 空 | 覆盖 master key；默认从集群 Secret `litellm/litellm-secrets` 读取 |
| `KUBECONFIG` | 标准规则 | k8s 访问 |

## 开发

```bash
make proto   # 重新生成 gRPC 代码（proto/ateapipb → gen/，工具装在 ./bin）
make tidy    # go mod tidy + 前端类型检查
```

- API 契约：`API_CONTRACT.md`（前后端共享的接口定义）
- gRPC 定义 vendored 自上游 `pkg/proto/ateapipb/ateapi.proto`
- 前端：Vite + React + TS + Tailwind + shadcn/ui（Claude 奶白主题）+ TanStack Query（5s 轮询）

## 相关文档

- `docs/cluster-setup.md` — **集群侧全部改动清单**（重跑上游安装脚本会被覆盖，务必阅读）
- `docs/agent-images.md` — 如何开发/构建/部署 agent workload 镜像
- `docs/adr/0001-tool-gateway.md` — ADR：Tool Registry + Tool Gateway（agent 工具统一注册、组装与收口拦截）
- `docs/adr/0002-in-cluster-distribution.md` — ADR：分发模式——控制台作为集群内应用部署
- `examples/agent-python/` — 最小 agent 镜像示例（LiteLLM 网关 + durableDir 状态持久化）
