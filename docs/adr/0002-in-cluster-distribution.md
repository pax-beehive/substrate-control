# ADR-0002: 分发模式——控制台作为集群内应用（in-cluster）部署

- 状态：已接受（Accepted）
- 日期：2026-07-19
- 决策者：toddzheng + Kimi（结对设计）

## 背景

substrate-control 目前以"工作站本地进程"形态运行，绑定单台机器的环境：

- gRPC 经本机 `kubectl port-forward` + `kubectl create token` 接入 ate-api-server
- k8s API 使用本机 kubeconfig（实为 cluster-admin 权限，超出最小必要）
- LiteLLM / router 等地址写死为特定集群的 NodePort IP
- 前端依赖本机 Node.js（Vite dev）或预构建 dist 目录

这无法分发给"任意一个装有 Substrate 的 Kubernetes 集群"使用。目标：一条 `kubectl apply` 完成安装，且不假设目标集群具备 LiteLLM、metrics-server、特定 ingress controller 等任何非 Substrate 原生组件。

## 决策

**主分发形态改为 in-cluster Deployment**（控制台部署进目标集群），本机 port-forward 模式保留为开发用途：

1. **incluster 认证模式**：后端检测到 `KUBERNETES_SERVICE_HOST` 即切换——直连 `api.ate-system.svc:443`，身份用 ServiceAccount token 投影卷（audience `api.ate-system.svc`，与 ate-controller/atenet-router 同姿势）；token 文件轮换时自动重读。gRPC TLS 一期沿用 skip-verify（与 portforward 模式一致），接 servicedns CA 校验留作后续。
2. **最小权限 RBAC**：按控制台实际能力面收敛——ActorTemplate/WorkerPool/SandboxConfig CRD 读写、secrets 管理、nodes/metrics.k8s.io 只读、litellm namespace 内 master-key secret 只读（见"已知妥协"）。
3. **单镜像交付**：前端 dist 以 `go:embed` 打进 Go 二进制（disk 静态目录模式保留给 dev）；多阶段 Dockerfile 一次产出前后端，用户侧零 Node 依赖。
4. **kustomize/plain manifests**（`deploy/`）：namespace、SA、ClusterRole(+Binding)、Deployment、Service、Ingress 示例；镜像发布到 ghcr.io（亦支持用户 `make image` 自建替换）。暂不做 Helm/Operator。
5. **依赖全部可选**：LiteLLM、metrics-server、actor 流量 ingress 缺失时对应页面区块降级为警告提示（现有代码已具备该行为），核心功能（Actors/Workers/Templates/Pools/Atespaces/Secrets 管理）在纯 Substrate 集群上即装即用。
6. **配置约定**：集群内默认值走 service DNS（`api.ate-system.svc:443`、`atenet-router.ate-system.svc:80`、`litellm.litellm.svc:4000`），均可由 env 覆盖；不再出现任何特定集群的 IP。

## 备选方案

| 方案 | 结论 |
|---|---|
| 维持本地二进制分发（用户自带 kubeconfig 运行） | 否决作为主形态：安装面大（Go/Node/kubeconfig）、权限过宽、无法集中管控；保留为开发模式 |
| Helm chart | 暂缓：kustomize/plain manifests 已足够表达，先零依赖；用户有需求再加 |
| Kubernetes Operator | 否决：控制台是无状态 Web 应用，Operator 引入无谓复杂度 |
| in-cluster gRPC 直接校验 servicedns CA | 暂缓：依赖集群侧 CA 材料（当前自签体系为临时态），一期 skip-verify + SA token，后续 CA 体系稳定后补上 |

## 已知妥协

- **secrets 权限面**：控制台支持在任意 namespace 创建/删除 secret（agent 模板与 namespace 自由组合），v1 只能授予 cluster 级 secrets 读写。文档需明示；后续加"可管理 namespace 白名单"配置收敛。
- **镜像信任**：用户需信任 ghcr 发布物或自行构建。发布流水线（构建+推送）纳入仓库 Makefile/CI 并记录于文档。

## 后果

**正面**：
- 一条 `kubectl apply -f` 完成安装；权限收敛到最小必要；前端零 Node 依赖
- 连接拓扑反而简化：去掉 port-forward 管理器，API/router/LiteLLM 全部走集群内 service DNS
- 与 Substrate 自身组件（controller/router）的接入方式完全一致，跟随上游演进成本低

**代价**：
- 需要镜像构建/发布流水线（多架构 linux/amd64+arm64）
- token 文件轮换、incluster 配置探测等新代码路径需要测试覆盖（dev 的 portforward 模式不能再作为唯一被验证路径）

## 参考

- [ADR-0001](./0001-tool-gateway.md)
- 本仓库：`docs/cluster-setup.md`（现有集群接线）、上游 `manifests/ate-install/jwt/patches.yaml`（SA token 投影的官方姿势）
