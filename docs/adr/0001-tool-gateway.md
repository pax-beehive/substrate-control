# ADR-0001: Tool Registry + Tool Gateway（agent 工具统一注册、组装与收口拦截）

- 状态：已接受（Accepted）
- 日期：2026-07-19
- 决策者：toddzheng + Kimi（结对设计）

## 背景

控制台正在向"persona 抽象"演进：`persona = system prompt + 模型 + 工具集`，创建 actor 时按 persona 组装。当前状态：

- **模型侧已闭环**：LiteLLM 网关（注册上游模型 → 签虚拟 key → 统一收口 → 审计/budget），actor 只见虚拟 key，真实 provider key 不落 actor。
- **工具侧是散的**：工具内置在各 agent 镜像里（harness 各自实现），没有注册中心，没有统一管控。persona 的"挂工具"无的放矢。
- **行为控制缺收口**：harness 将是异构的（Claude Code、ADK、自研镜像）。在每个 harness 内做行为控制等于没有控制——认证授权不在应用内做而在网关做，是同一道理。

上游 Substrate 路线图中的两条与本决策直接同构：

- *Credential injection via proxies to eliminate exposure of cryptographic keys and bearer tokens to actors*（凭证经代理注入，actor 不接触真实密钥）
- *Native MCP Server Hosting* + egress/peer 网络策略（actor 出网收口与工具生态）

## 决策

**引入 Tool Gateway，与 LiteLLM 模型网关完全对称的架构**：

1. **Tool Registry**：控制台管理的一等实体。登记 MCP server（http/sse/stdio）、HTTP/OpenAPI 工具，含连接配置与真实凭证（加密存放，不落 actor）。
2. **Tool Gateway**：集群内部署（namespace `litellm` 同策略，traefik ingress 暴露），职责：
   - 按 persona 的 toolset 组装工具视图（allowlist 过滤，actor 只见被授权的工具）
   - 调用拦截：全量调用日志、拒绝非授权调用、限流；参数审查/脱敏
   - 真实凭证注入：actor 持虚拟 key（或不持凭证），真实第三方凭证由网关注入
3. **工具一律 MCP/HTTP 化**：harness 进程内的 function tool 不在受控面内，约定禁止（harness 不得私藏网络类工具）。MCP 为标准协议，与上游 Native MCP Hosting 方向一致。
4. **persona 定型**：`persona = prompt + model 别名（LiteLLM）+ toolset（Tool Gateway）`，三实体均在控制台注册管理；actor 启动时获取两个网关地址（env 注入）。
5. **分期实施**：
   - 一期：Registry + Gateway 部署 + 控制台管理页 + allowlist 组装 + 全量调用日志
   - 二期：参数级策略（OPA 或等价物）、human-in-the-loop 审批（会打断 agent loop，单独设计）、按虚拟 key 的用量统计
6. **选型优先**：先验证开源 MCP 网关（mcp-proxy 类、或 LiteLLM 自带的 MCP gateway 能力）能否满足 2 的职责；不满足再自研（Go，与控制台灯后端的 LiteLLM 管理模式同构）。

## 备选方案

| 方案 | 结论 |
|---|---|
| 各 harness 内做工具控制 | 否决：harness 异构，控制不成体系；不可信代码场景下等于无控制 |
| 仅控制台配置工具（无代理） | 否决：无执行点与审计点，配置只是"声明"，无法"拦截" |
| 直接自研 Go 网关，不评估开源 | 暂缓：先选型，避免重造；自研作为兜底 |
| 复用 LiteLLM 的 MCP gateway 能力 | 候选之一，与独立 MCP 网关一并评估；若成熟可减少一个组件 |
| 允许进程内 function tool | 否决：网关不可见，破坏统一收口前提 |

## 后果

**正面**：
- persona 抽象闭环：prompt/model/toolset 三实体齐备，控制台成为完整的 agent 装配台
- 与 LiteLLM 对称的管控面：模型与工具两类外部依赖同构治理，心智负担低
- 凭证隔离与全量审计：actor 不接触真实工具凭证；每次工具调用有日志可查
- 与上游方向对齐：credential injection、egress 收口、MCP 生态，未来可平移到上游原生能力

**代价**：
- 新增一个常驻组件（Deployment + 存储），运维面扩大
- 工具调用多一跳代理延迟（集群内 RPC，可接受；需关注网关可用性成为单点——一期单副本可接受，后续按需扩）
- "工具一律 MCP/HTTP 化"对 harness 有改造成本（现有示例镜像不受影响——尚无工具）

**运维注记**：
- 部署清单放入 `hack/`（同 litellm-deploy.yaml 惯例），变更同步记录到 `docs/cluster-setup.md`
- 一期网关自身认证复用 LiteLLM 模式：管理面由控制台后端代理，master key 不过浏览器

## 参考

- [Substrate roadmap](https://github.com/agent-substrate/substrate/blob/main/docs/roadmap.md)（credential injection / Native MCP Hosting / egress policy）
- 本仓库：`docs/agent-images.md`（harness 契约）、ADR 讨论见 2026-07-19 会话
