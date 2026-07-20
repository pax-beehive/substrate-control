import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"

import * as api from "@/lib/api"
import { formatAge, formatDateTime } from "@/lib/format"
import { ActorActions } from "@/components/ActorActions"
import { CreateActorDialog } from "@/components/CreateActorDialog"
import { StatusBadge } from "@/components/StatusBadge"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
} from "@/components/states"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const ALL_ATESPACES = "all"

export default function ActorsPage() {
  const [atespaceFilter, setAtespaceFilter] = useState(ALL_ATESPACES)
  const [createOpen, setCreateOpen] = useState(false)

  const atespacesQuery = useQuery({
    queryKey: ["atespaces"],
    queryFn: api.listAtespaces,
    refetchInterval: 5000,
  })
  const actorsQuery = useQuery({
    queryKey: ["actors", atespaceFilter],
    queryFn: () =>
      api.listActors(
        atespaceFilter === ALL_ATESPACES ? undefined : atespaceFilter,
      ),
    refetchInterval: 5000,
  })

  const atespaces = atespacesQuery.data?.atespaces ?? []
  const actors = actorsQuery.data?.actors ?? []

  return (
    <>
      <PageHeader
        title="Actors"
        description="Stateful workload instances multiplexed onto the worker pool."
      >
        <Select value={atespaceFilter} onValueChange={setAtespaceFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Atespace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ATESPACES}>All atespaces</SelectItem>
            {atespaces.map((space) => (
              <SelectItem key={space.name} value={space.name}>
                {space.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Create Actor
        </Button>
      </PageHeader>

      {actorsQuery.isLoading ? (
        <TableSkeleton columns={7} />
      ) : actorsQuery.isError ? (
        <ErrorState title="Failed to load actors" error={actorsQuery.error} />
      ) : actors.length === 0 ? (
        <EmptyState
          title="No actors yet — create one"
          description={
            atespaceFilter === ALL_ATESPACES
              ? undefined
              : `No actors in atespace "${atespaceFilter}".`
          }
          action={
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              Create Actor
            </Button>
          }
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Atespace</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Worker Pool</TableHead>
                <TableHead>Pod</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {actors.map((actor) => (
                <TableRow key={`${actor.atespace}/${actor.name}`}>
                  <TableCell className="font-medium">
                    <Link
                      className="text-primary hover:underline"
                      to={`/actors/${encodeURIComponent(actor.atespace)}/${encodeURIComponent(actor.name)}`}
                    >
                      {actor.name}
                    </Link>
                  </TableCell>
                  <TableCell>{actor.atespace}</TableCell>
                  <TableCell
                    className="max-w-56 truncate text-muted-foreground"
                    title={`${actor.actorTemplateNamespace}/${actor.actorTemplateName}`}
                  >
                    {actor.actorTemplateNamespace}/{actor.actorTemplateName}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={actor.status} />
                  </TableCell>
                  <TableCell>{actor.workerPoolName || "—"}</TableCell>
                  <TableCell
                    className="max-w-44 truncate text-muted-foreground"
                    title={actor.ateomPodName}
                  >
                    {actor.ateomPodName || "—"}
                  </TableCell>
                  <TableCell title={formatDateTime(actor.createTime)}>
                    {formatAge(actor.createTime)}
                  </TableCell>
                  <TableCell>
                    <ActorActions actor={actor} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateActorDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
