import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import * as api from "@/lib/api"
import { formatAge, formatDateTime, truncateMiddle } from "@/lib/format"
import type { KeySpend, ModelSpend } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
  WarningState,
} from "@/components/states"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const LIMITS = ["50", "100", "200", "500"]

function usd(value: number): string {
  return `$${value.toFixed(2)}`
}

function num(value: number): string {
  return value.toLocaleString()
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string
  value: string
  subtitle?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

// Usage bar colored clay → amber → red at the ~70%/~90% thresholds.
function UsageBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const color =
    clamped >= 90
      ? "bg-[#C2402F]"
      : clamped >= 70
        ? "bg-[#C98F2A]"
        : "bg-primary"
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted">
        <div
          className={cn("h-1.5 rounded-full", color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {Math.round(clamped)}%
      </span>
    </div>
  )
}

function ShareBar({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(100, ratio * 100))
  return (
    <div className="h-1 w-full rounded-full bg-muted">
      <div className="h-1 rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function MonitoringPage() {
  const [limit, setLimit] = useState("100")

  const overviewQuery = useQuery({
    queryKey: ["metricsOverview"],
    queryFn: api.getMetricsOverview,
    refetchInterval: 10000,
    retry: false,
  })
  const overview = overviewQuery.data
  const gateway = overview?.gateway
  const reachable = gateway?.reachable === true

  const spendLogsQuery = useQuery({
    queryKey: ["spendLogs", limit],
    queryFn: () => api.getSpendLogs(Number(limit)),
    enabled: reachable,
    refetchInterval: 15000,
    retry: false,
  })
  const logs = spendLogsQuery.data?.items ?? []

  const spendByKey = gateway?.spendByKey ?? []
  const spendByModel = gateway?.spendByModel ?? []
  const maxKeySpend = Math.max(0, ...spendByKey.map((row) => row.spend))
  const maxModelSpend = Math.max(0, ...spendByModel.map((row) => row.spend))

  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Cluster usage, substrate counts, and LLM token spend."
      />

      {overviewQuery.isLoading ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <TableSkeleton columns={6} />
        </>
      ) : overviewQuery.isError || !overview ? (
        <ErrorState
          title="Failed to load metrics overview"
          error={overviewQuery.error}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              title="Total spend"
              value={reachable ? usd(gateway.totalSpend) : "—"}
              subtitle={
                reachable
                  ? gateway.maxBudget > 0
                    ? `max budget ${usd(gateway.maxBudget)}`
                    : "no budget cap"
                  : "gateway unreachable"
              }
            />
            <StatCard
              title="Total tokens"
              value={reachable ? num(gateway.tokens.total) : "—"}
              subtitle={
                reachable
                  ? `prompt ${num(gateway.tokens.prompt)} / completion ${num(gateway.tokens.completion)}`
                  : undefined
              }
            />
            <StatCard
              title="Requests"
              value={reachable ? num(gateway.totalRequests) : "—"}
              subtitle="in current spend-log window"
            />
            <StatCard
              title="Workers"
              value={`${overview.substrate.workersAssigned}/${overview.substrate.workersTotal}`}
              subtitle={`${overview.substrate.workersIdle} idle`}
            />
            <StatCard
              title="Actors running"
              value={String(overview.substrate.actorsRunning)}
              subtitle={`${overview.substrate.actorsSuspended} suspended · ${overview.substrate.actorsCrashed} crashed`}
            />
          </div>

          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold">LLM usage</h2>
            {!reachable ? (
              <WarningState
                title="Gateway unreachable"
                message="LLM metrics unavailable — the gateway is unconfigured or down."
              />
            ) : spendByKey.length === 0 && spendByModel.length === 0 ? (
              <EmptyState title="No LLM traffic recorded yet" />
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Spend by key</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Alias</TableHead>
                          <TableHead>Key</TableHead>
                          <TableHead>Requests</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Spend</TableHead>
                          <TableHead className="w-24" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {spendByKey.map((row: KeySpend) => (
                          <TableRow key={row.keyName || row.keyAlias}>
                            <TableCell className="font-medium">
                              {row.keyAlias || "—"}
                            </TableCell>
                            <TableCell
                              className="font-mono text-xs text-muted-foreground"
                              title={row.keyName}
                            >
                              {truncateMiddle(row.keyName)}
                            </TableCell>
                            <TableCell>{num(row.requests)}</TableCell>
                            <TableCell>{num(row.tokens)}</TableCell>
                            <TableCell>{usd(row.spend)}</TableCell>
                            <TableCell>
                              <ShareBar
                                ratio={
                                  maxKeySpend > 0 ? row.spend / maxKeySpend : 0
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Spend by model</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead>Requests</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Spend</TableHead>
                          <TableHead className="w-24" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {spendByModel.map((row: ModelSpend) => (
                          <TableRow key={row.model}>
                            <TableCell className="font-mono text-xs">
                              {row.model}
                            </TableCell>
                            <TableCell>{num(row.requests)}</TableCell>
                            <TableCell>{num(row.tokens)}</TableCell>
                            <TableCell>{usd(row.spend)}</TableCell>
                            <TableCell>
                              <ShareBar
                                ratio={
                                  maxModelSpend > 0
                                    ? row.spend / maxModelSpend
                                    : 0
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold">Kubernetes</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nodes</CardTitle>
                </CardHeader>
                <CardContent>
                  {!overview.nodes.available ? (
                    <WarningState title="metrics-server unavailable" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>CPU</TableHead>
                          <TableHead>Memory</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(overview.nodes.items ?? []).map((node) => (
                          <TableRow key={node.name}>
                            <TableCell className="font-medium">
                              {node.name}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span className="font-mono text-xs">
                                  {node.cpuUsage}
                                </span>
                                <UsageBar percent={node.cpuPercent} />
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span className="font-mono text-xs">
                                  {node.memoryUsage}
                                </span>
                                <UsageBar percent={node.memoryPercent} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Pods by namespace
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!overview.pods.available ? (
                    <WarningState title="metrics-server unavailable" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Namespace</TableHead>
                          <TableHead>Pods</TableHead>
                          <TableHead>CPU</TableHead>
                          <TableHead>Memory</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(overview.pods.items ?? []).map((ns) => (
                          <TableRow key={ns.namespace}>
                            <TableCell className="font-medium">
                              {ns.namespace}
                            </TableCell>
                            <TableCell>{ns.podCount}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {ns.cpuUsage}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {ns.memoryUsage}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Recent requests</CardTitle>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMITS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {!reachable ? (
                <WarningState
                  title="Gateway unreachable"
                  message="Spend logs unavailable — the gateway is unconfigured or down."
                />
              ) : spendLogsQuery.isLoading ? (
                <TableSkeleton columns={7} rows={4} />
              ) : spendLogsQuery.isError ? (
                <ErrorState
                  title="Failed to load spend logs"
                  error={spendLogsQuery.error}
                />
              ) : logs.length === 0 ? (
                <EmptyState title="No requests in the current window" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Key alias</TableHead>
                      <TableHead>Prompt</TableHead>
                      <TableHead>Completion</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Spend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.requestId}>
                        <TableCell
                          className="text-muted-foreground"
                          title={formatDateTime(log.startTime)}
                        >
                          {formatAge(log.startTime)} ago
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.model}
                        </TableCell>
                        <TableCell>{log.keyAlias || "—"}</TableCell>
                        <TableCell>{num(log.promptTokens)}</TableCell>
                        <TableCell>{num(log.completionTokens)}</TableCell>
                        <TableCell>{num(log.totalTokens)}</TableCell>
                        <TableCell>{usd(log.spend)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
