import type { ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"

import * as api from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import { ActorActions } from "@/components/ActorActions"
import { ActorTaskPanel } from "@/components/ActorTaskPanel"
import { StatusBadge } from "@/components/StatusBadge"
import { ErrorState, TableSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function Field({
  label,
  children,
}: {
  label: string
  children?: ReactNode
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm break-words">{children ?? "—"}</dd>
    </div>
  )
}

export default function ActorDetailPage() {
  const { atespace = "", name = "" } = useParams()
  const navigate = useNavigate()

  const actorQuery = useQuery({
    queryKey: ["actor", atespace, name],
    queryFn: () => api.getActor(atespace, name),
    refetchInterval: 5000,
  })
  const actor = actorQuery.data

  if (actorQuery.isLoading) {
    return <TableSkeleton columns={3} rows={4} />
  }
  if (actorQuery.isError || !actor) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft />
            Back to actors
          </Link>
        </Button>
        <ErrorState
          title={`Failed to load actor ${atespace}/${name}`}
          error={actorQuery.error}
        />
      </div>
    )
  }

  const matchLabels = Object.entries(actor.workerSelector?.matchLabels ?? {})
  const snapshot = actor.snapshotInfo

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to actors">
          <Link to="/">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{actor.name}</h1>
        <StatusBadge status={actor.status} />
        <div className="ml-auto">
          <ActorActions
            actor={actor}
            variant="buttons"
            onDeleted={() => navigate("/")}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Atespace">{actor.atespace}</Field>
            <Field label="Name">{actor.name}</Field>
            <Field label="UID">
              <span className="font-mono text-xs">{actor.uid || "—"}</span>
            </Field>
            <Field label="Version">{actor.version}</Field>
            <Field label="Template">
              {actor.actorTemplateNamespace}/{actor.actorTemplateName}
            </Field>
            <Field label="Worker Pool">{actor.workerPoolName || "—"}</Field>
            <Field label="Created">{formatDateTime(actor.createTime)}</Field>
            <Field label="Updated">{formatDateTime(actor.updateTime)}</Field>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pod</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4">
              <Field label="Pod namespace">{actor.ateomPodNamespace}</Field>
              <Field label="Pod name">{actor.ateomPodName}</Field>
              <Field label="Pod IP">
                {actor.ateomPodIP ? (
                  <span className="font-mono text-xs">{actor.ateomPodIP}</span>
                ) : undefined}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worker Selector</CardTitle>
          </CardHeader>
          <CardContent>
            {matchLabels.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {matchLabels.map(([key, value]) => (
                  <Badge
                    key={key}
                    variant="secondary"
                    className="font-mono text-xs"
                  >
                    {key}={value}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No worker selector — the actor can be placed on any worker.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot ? (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Type">{snapshot.type}</Field>
              {snapshot.snapshotUriPrefix && (
                <Field label="Snapshot URI prefix">
                  <span className="font-mono text-xs break-all">
                    {snapshot.snapshotUriPrefix}
                  </span>
                </Field>
              )}
              {snapshot.snapshotPrefix && (
                <Field label="Snapshot prefix">
                  <span className="font-mono text-xs break-all">
                    {snapshot.snapshotPrefix}
                  </span>
                </Field>
              )}
              {snapshot.nodeVmsWithLocalSnapshots &&
                snapshot.nodeVmsWithLocalSnapshots.length > 0 && (
                  <Field label="Node VMs with local snapshots">
                    <span className="flex flex-wrap gap-1">
                      {snapshot.nodeVmsWithLocalSnapshots.map((nodeVm) => (
                        <Badge
                          key={nodeVm}
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {nodeVm}
                        </Badge>
                      ))}
                    </span>
                  </Field>
                )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No snapshot recorded for this actor yet.
            </p>
          )}
        </CardContent>
      </Card>

      <ActorTaskPanel actor={actor} />
    </>
  )
}
