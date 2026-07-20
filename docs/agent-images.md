# Agent 镜像开发指南

Substrate 对 workload 镜像**零 SDK 要求**——普通 OCI 镜像即可。本指南基于 `examples/agent-python/`（一个可调用的最小 LLM agent）。

## 平台契约

| 要求 | 说明 |
|---|---|
| 架构 | **linux/amd64**（集群节点 x86_64；Mac 构建必须跨平台） |
| 流量入口 | 监听 **80 端口**（atenet router 把 actor 流量转到 `workerIP:80`） |
| 状态持久化 | 要跨 suspend 保留的状态写到模板里 **durableDir 卷**的挂载路径（如 `/data`）；内存状态在 `onCommit: Data` 下会丢弃 |
| 配置注入 | 全部走 **env**（字面量或 `secretKeyRef`）；API key 推荐用网关虚拟 key + secretKeyRef |
| 启动命令 | **模板必须显式写 `command`**——ateom 不读镜像自带的 CMD/ENTRYPOINT（实测教训） |
| 镜像引用 | CRD 强制 **digest 钉住**（`@sha256:...`），否则 422：`All images must be pinned` |

## 构建与推送（Mac，零 Docker 配置）

本地 registry 是 HTTP 协议，Docker Desktop 默认拒绝。用 `crane --insecure` 绕过（无需改 daemon 配置）：

```bash
cd examples/agent-python

# 1. 构建（linux/amd64）并导出
docker buildx build --platform linux/amd64 -t agent-python:v1 --load .
docker save agent-python:v1 -o /tmp/agent.tar

# 2. 推送（crane 在 GOBIN=/tmp/ko-bin 已装；或 go install github.com/google/go-containerregistry/cmd/crane@latest）
crane push --insecure /tmp/agent.tar 100.125.72.76:32000/agent-python:v1

# 3. 取 digest（模板里钉住）
crane digest --insecure 100.125.72.76:32000/agent-python:v1
# → 模板 image 字段：localhost:32000/agent-python@sha256:<digest>
```

Go 应用也可以用 ko（与 ateom 镜像同法）：`KO_DOCKER_REPO=100.125.72.76:32000 ko build --insecure-registry --platform=linux/amd64 ./cmd/myagent`

## 完整 ActorTemplate 示例

```yaml
apiVersion: ate.dev/v1alpha1
kind: ActorTemplate
metadata:
  name: my-agent
  namespace: agents        # 与引用 secret 同 namespace
spec:
  pauseImage: registry.k8s.io/pause:3.10.2@sha256:f548e0e8e3dc1896ca956272154dde3314e8cc4fde0a57577ee9fa1c63f5baf4
  containers:
  - name: agent
    image: localhost:32000/agent-python@sha256:17e6bf1f...   # digest 钉住
    command: ["python", "/app/main.py"]                       # 必须显式
    readyz: { httpGet: { path: /readyz, port: 80 } }
    env:
    - name: LLM_API_KEY                                       # 网关虚拟 key
      valueFrom: { secretKeyRef: { name: litellm-key, key: api-key } }
    - name: LLM_BASE_URL
      value: http://litellm.litellm.svc:4000
    - name: MODEL
      value: claude-sonnet                                    # Gateway·Models 里注册的别名
    - name: STATE_DIR
      value: /data
    volumeMounts: [ { name: data, mountPath: /data } ]
  workerSelector: { matchLabels: { workload: agents } }       # 匹配 pool 的 metadata.labels
  snapshotsConfig:
    onPause: Full        # pause 快照内容（留节点本地）
    onCommit: Data       # suspend 快照内容（传 rustfs）：Full=内存+rootfs，Data=仅 durableDir
    location: s3://ate-snapshots/agents/
  volumes:
  - name: data
    durableDir: {}
```

## 配套资源清单（控制台上创建）

1. **Gateway → Models**：注册上游模型（如 `deepseek/deepseek-v4-pro` + 真实 provider key），别名用于 `MODEL` env
2. **Gateway → Virtual Keys**：签虚拟 key，弹窗里一键存成 `litellm-key/api-key`（模板同 namespace）
3. **Worker Pools**：建 pool，`metadata.labels` 与模板 `workerSelector` 一致（如 `workload: agents`），`ateomImage` 用 `localhost:32000/ateom-gvisor-...@sha256:b94d...`
4. **Atespaces**：建空间后在其中建 Actor（模板 namespace/name 可跨 namespace 引用）

## 任务接口的设计自由

示例镜像只有 `GET /` 和 `POST /ask`。任务模型完全自定义，常见模式：

- **同步问答**：`POST /ask`（现状）
- **异步长任务**：`POST /tasks` 创建任务（落 durableDir）→ 后台执行 → `GET /tasks/{id}` 查询；suspend/resume 不丢进度
- **多轮对话**：session state 存 durableDir 的 sqlite/json
- **循环自主体**：读 env 的 `TASK`/`INTERVAL_SECONDS` 自己循环（上游 claude-code-multiplex 模式）

调试入口：控制台 actor 详情页 Task 面板，或 `curl -H "Host: <actor>.<atespace>.actors.resources.substrate.ate.dev" http://100.125.72.76:31358/<path>`。
