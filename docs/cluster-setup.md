# 集群改动清单（MicroK8s 上的 Substrate）

本文档记录为让 Agent Substrate 在这套 MicroK8s 集群上完整工作所做的**全部集群侧改动**。

> **警告：这些都是 live 状态修改。在工作站上重跑 `hack/install-ate*.sh` 会重新渲染 manifest 并覆盖大部分改动。重跑后请对照本文档重新打补丁。**

集群背景：MicroK8s（节点 `toddzheng-workspace`），Substrate 装于 `ate-system` namespace（2026-07-19），上游处于 VERY early 阶段。

## 1. JWT issuer 修正（ate-api-server Deployment）

**问题**：`--client-jwt-issuer=https://kubernetes.default.svc.cluster.local` 是 kind 环境的值，MicroK8s 实际 issuer 是 `https://kubernetes.default.svc`，导致所有 SA token 认证失败（`Unauthenticated: unexpected issuer`）。

**改动**：args 中 `--client-jwt-issuer` 改为 `https://kubernetes.default.svc`。

## 2. svc/api targetPort 改回 443

**问题**：集群里曾部署过一个自建的 `grpc-reflect-proxy` sidecar（提供 gRPC 反射方便 grpcurl），把 svc `api` 的 targetPort 从 443 改到了 8443（proxy 的明文 h2c 端口）。后果：(a) 该 proxy 对所有数据 RPC 返回空消息（"假 stub"现象）；(b) 集群内组件（ate-controller 等）走 TLS 连 8443 必然握手失败，ActorTemplate 无法 reconcile。

**改动**：`kubectl patch svc -n ate-system api --type=json -p='[{"op":"replace","path":"/spec/ports/0/targetPort","value":443}]'`

## 3. 移除 grpc-reflect-proxy sidecar

**改动**：从 ate-api-server Deployment 删除 `grpc-reflect-proxy` 容器（非上游组件）。此后 30348（traefik websecure）不再是有效的 gRPC 入口；控制台/CLI 一律走 `kubectl port-forward -n ate-system deploy/ate-api-server <port>:443`。

## 4. servicedns 证书体系重建

**问题**：`servicedns-cred` Secret 里装的竟是 **valkey 的证书**（CN=valkey-cluster.ate-system.svc），导致集群内组件连 api 时 SAN 校验失败。原 CA 私钥不在集群中，无法补签。

**改动**：
- 重新自签 CA（CN=substrate-local-ca），CA 证书存于本 repo `hack/servicedns-ca/ca.crt`；**ca.key 不入库**（公开仓库，仅保留在本机 `hack/servicedns-ca/ca.key`，注意保密与备份；丢失则需重建 CA 并轮换所有依赖方证书）
- 签发服务端证书：CN=`api.ate-system.svc`，SAN 含 `api.ate-system.svc, api.ate-system, api, localhost, 127.0.0.1`
- `servicedns-cred`.`credential-bundle.pem` = 新私钥+服务端证书+CA 证书
- `servicedns-ca-cert` 的 `ca.crt` 与 `trust-bundle.pem` = 新 CA 证书（ate-controller、atenet-router 用它验证 api 证书）

## 5. api-server 的 valkey mTLS 分离

**问题**：api-server 的 `--redis-client-cert` 与 gRPC 服务端共用同一个 bundle 文件（`--grpc-server-cred-bundle`）。换证书后 valkey 不再信任新 CA（`tls: unknown certificate authority`）。

**改动**：原 valkey 证书 bundle 保存为 Secret `valkey-client-cred`；Deployment 增加该卷的挂载 `/run/valkey-client`，args 中 `--redis-client-cert` 指向新路径。valkey 侧零改动。

## 6. ate-controller 补 --ateapi-ca-file

**问题**：controller 的 `--ateapi-ca-file` 默认值是 k8s SA CA（`/var/run/secrets/.../ca.crt`），与 servicedns CA 不符（`certificate signed by unknown authority`）。

**改动**：args 增加 `--ateapi-ca-file=/run/servicedns-ca/trust-bundle.pem`。

## 7. atelet 存储接线 + 镜像 registry 解析

**问题 A**：atelet 存储配置为 `ATE_STORAGE_BACKEND=gcs` + `STORAGE_EMULATOR_HOST=localhost:4443`，但 gcs 模拟器并不存在（GKE 残留配置）。
**问题 B**：镜像引用 `localhost:32000/...` 在 pod 内解析为 pod 自身，拉取失败。

**改动**：
- env：`ATE_STORAGE_BACKEND=s3`、`AWS_REGION=us-east-1`、`AWS_ENDPOINT_URL=http://rustfs.ate-system.svc:9000`、`AWS_S3_USE_PATH_STYLE=true`、`AWS_ACCESS_KEY_ID=rustfsadmin`、`AWS_SECRET_ACCESS_KEY=rustfsadmin`；删除 `STORAGE_EMULATOR_HOST`
- args 增加 `--localhost-registry-replacement=registry.container-registry.svc:5000`

## 8. atenet-router 补 JWT 接线

**问题**：router 调 api 健康检查持续 `Unauthenticated: missing bearer token`（缺 token 配置），对 actor 流量一律返回 "authentication required"。

**改动**：args 增加 `--ateapi-auth=jwt`、`--ateapi-token-file=/run/ateapi-token/token`；增加 `ateapi-token` projected volume（serviceAccountToken，audience `api.ate-system.svc`，3600s）及挂载。（与上游 `manifests/ate-install/jwt/patches.yaml` 一致）

## 9. rustfs（快照存储）部署

**背景**：上游 kind 流程标配，本地 S3 兼容对象存储，数据落 1Gi PVC（节点本地盘），无外部依赖。

**改动**：`kubectl apply -f manifests/ate-install/kind/rustfs.yaml`（来自上游仓库；含 Deployment、Service、PVC、bucket-init Job）。bucket `ate-snapshots` 已由 init Job 创建。模板中 `snapshotsConfig.location` 填 `s3://ate-snapshots/<前缀>/`。

## 10. Actor HTTP 流量 ingress

**改动**：traefik IngressRoute `substrate-actors-http`（ate-system）：entryPoint `web`，`HostRegexp(` + "`^.+\\.actors\\.resources\\.substrate\\.ate\\.dev$`" + `)` → svc `atenet-router:80`。
- 访问方式：`curl -H "Host: <actor>.<atespace>.actors.resources.substrate.ate.dev" http://100.125.72.76:31358/`
- **注意**：traefik v3 的 HostRegexp 不认 v2 命名组语法（`{any:.+}`），必须用纯正则形式

## 11. LiteLLM 网关部署

**位置**：namespace `litellm`（Postgres + PVC + LiteLLM proxy + traefik ingress `/litellm` 前缀）。

**部署**：`kubectl apply -f hack/litellm-deploy.yaml`（本 repo；master key / DB 密码为占位符，需先替换）。要点：
- `SERVER_ROOT_PATH=/litellm` + traefik stripPrefix middleware
- `LITELLM_SALT_KEY` 必须配置（注册模型的 provider key 加密落盘 Postgres）
- 管理 UI：`http://100.125.72.76:31358/litellm/ui`；集群内 actor 直连 `http://litellm.litellm.svc:4000`
- master key 存于 Secret `litellm/litellm-secrets`，控制台后端启动时自行读取

## 12. metrics-server 部署（监控数据来源）

**改动**：按上游标准 manifest 部署 metrics-server 到 `kube-system`，并加 `--kubelet-insecure-tls`（MicroK8s kubelet 自签证书需要）。控制台的 Monitoring 页依赖它提供节点/pod 的 CPU/内存用量；未部署时该区块降级为警告提示。

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deploy -n kube-system metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

## 13. substrate-control 控制台自身部署（namespace substrate-control）

**改动**：控制台以 Deployment 部署进集群（`kubectl apply -k deploy/`，幂等），incluster 模式直连 `api.ate-system.svc:443` + SA token 投影卷（audience `api.ate-system.svc`）。镜像 `localhost:32000/substrate-control:latest` 为本地构建（多阶段 Dockerfile，前端 go:embed 内嵌）。RBAC：CRD 读写、cluster 级 secrets、metrics/nodes 只读、litellm namespace 内 `litellm-secrets` 只读。访问：`kubectl port-forward -n substrate-control svc/substrate-control 8080:8080`。

## 已知问题与运维备忘

1. **valkey 集群不耐重启**：valkey pod 重启后 `nodes.conf` 中旧 pod IP 失效，进入少数派分区（`CLUSTERDOWN`），导致 api-server 全部 DB 操作报 500。修复：`kubectl apply -f hack/valkey-repair-job.yaml`（job 完成即修复；需先 `kubectl delete job -n ate-system valkey-cluster-repair` 再 apply）。上游未做 hostname announce，属设计缺陷。
2. **僵尸 golden actor**：曾因 `runsc create` 失败残留一个 RESUMING 状态的 golden actor 占住 worker。释放办法：等控制面超时、重启 ate-api-server，或给 pool 扩副本绕过。
3. **Actor HTTPS 未启用**：atenet-router 的 envoy HTTPS listener（8443）因 `servicedns` 卷为空无法加载证书，actor 仅 HTTP :80 可达。修复需要为 `*.actors.resources.substrate.ate.dev` 签发证书并挂入该卷。
4. **ate-api-server 镜像版本**：当前运行的是用户安装时的构建；`ateom-gvisor` 镜像是 2026-07-19 从上游 main 构建推送的（`localhost:32000/ateom-gvisor-715889664656de67e44382a8d6ab981d@sha256:b94d...`），目前接口兼容。
