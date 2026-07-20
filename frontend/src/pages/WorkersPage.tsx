import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CircleDashed, Link2, Server } from "lucide-react"

import * as api from "@/lib/api"
import type { Worker } from "@/lib/types"
import { LabelsCell } from "@/components/LabelsCell"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
} from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function SummaryCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string
  value: number
  icon: typeof Server
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{loading ? "—" : value}</div>
      </CardContent>
    </Card>
  )
}

function AssignmentCell({ worker }: { worker: Worker }) {
  if (!worker.assignment) {
    return <Badge variant="secondary">Idle</Badge>
  }
  const { actor } = worker.assignment
  return (
    <Link
      className="text-primary hover:underline"
      to={`/actors/${encodeURIComponent(actor.atespace)}/${encodeURIComponent(actor.name)}`}
    >
      {actor.atespace}/{actor.name}
    </Link>
  )
}

export default function WorkersPage() {
  const workersQuery = useQuery({
    queryKey: ["workers"],
    queryFn: api.listWorkers,
    refetchInterval: 5000,
  })
  const workers = workersQuery.data?.workers ?? []
  const assigned = workers.filter((worker) => worker.assignment != null)

  return (
    <>
      <PageHeader
        title="Workers"
        description="Physical pods that host at most one actor at a time."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Total workers"
          value={workers.length}
          icon={Server}
          loading={workersQuery.isLoading}
        />
        <SummaryCard
          title="Assigned"
          value={assigned.length}
          icon={Link2}
          loading={workersQuery.isLoading}
        />
        <SummaryCard
          title="Idle"
          value={workers.length - assigned.length}
          icon={CircleDashed}
          loading={workersQuery.isLoading}
        />
      </div>

      {workersQuery.isLoading ? (
        <TableSkeleton columns={7} />
      ) : workersQuery.isError ? (
        <ErrorState title="Failed to load workers" error={workersQuery.error} />
      ) : workers.length === 0 ? (
        <EmptyState
          title="No workers registered"
          description="Worker pods appear here once a WorkerPool is running."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pool</TableHead>
                <TableHead>Pod</TableHead>
                <TableHead>Node</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Sandbox</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead>Labels</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((worker) => (
                <TableRow
                  key={`${worker.workerNamespace}/${worker.workerPod}`}
                >
                  <TableCell className="font-medium">
                    {worker.workerPool}
                  </TableCell>
                  <TableCell
                    className="max-w-48 truncate"
                    title={worker.workerPod}
                  >
                    {worker.workerPod}
                  </TableCell>
                  <TableCell
                    className="max-w-40 truncate text-muted-foreground"
                    title={worker.nodeName}
                  >
                    {worker.nodeName || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {worker.ip || "—"}
                  </TableCell>
                  <TableCell>{worker.sandboxClass || "—"}</TableCell>
                  <TableCell>
                    <AssignmentCell worker={worker} />
                  </TableCell>
                  <TableCell>
                    <LabelsCell labels={worker.labels} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
