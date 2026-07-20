import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { formatAge, formatDateTime } from "@/lib/format"
import { replicaCount } from "@/lib/k8s"
import type { K8sObject } from "@/lib/types"
import { CreatePoolDialog } from "@/components/CreatePoolDialog"
import { K8sObjectDetailsDialog } from "@/components/K8sObjectDetailsDialog"
import { LabelsCell } from "@/components/LabelsCell"
import {
  EmptyState,
  PageHeader,
  TableSkeleton,
  WarningState,
} from "@/components/states"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function PoolsPage() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<K8sObject | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<K8sObject | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const poolsQuery = useQuery({
    queryKey: ["workerpools"],
    queryFn: api.listWorkerPools,
    refetchInterval: 5000,
    retry: false,
  })
  const items = poolsQuery.data?.items
  const pools = items ?? []
  const namespaces = useMemo(
    () => [...new Set((items ?? []).map((item) => item.namespace))].sort(),
    [items],
  )

  const deleteMutation = useMutation({
    mutationFn: (target: K8sObject) =>
      api.deleteWorkerPool(target.namespace, target.name),
    onSuccess: (_data, target) => {
      toast.success("WorkerPool deleted", {
        description: `${target.namespace}/${target.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["workerpools"] })
      setDeleteTarget(null)
    },
    onError: (error) => {
      toast.error("Failed to delete pool", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  return (
    <>
      <PageHeader
        title="Worker Pools"
        description="WorkerPool CRDs defining the pool of worker pods."
      >
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Create Pool
        </Button>
      </PageHeader>

      {poolsQuery.isLoading ? (
        <TableSkeleton columns={6} />
      ) : poolsQuery.isError ? (
        <WarningState
          title="WorkerPools unavailable"
          message={`The backend may not have cluster access. ${
            poolsQuery.error instanceof Error ? poolsQuery.error.message : ""
          }`}
        />
      ) : pools.length === 0 ? (
        <EmptyState
          title="No WorkerPools found"
          description="Create one here, or apply WorkerPool CRDs to the cluster."
          action={
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              Create Pool
            </Button>
          }
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namespace</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Replicas</TableHead>
                <TableHead>Labels</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pools.map((pool) => {
                const replicas = replicaCount(pool)
                return (
                  <TableRow key={`${pool.namespace}/${pool.name}`}>
                    <TableCell className="text-muted-foreground">
                      {pool.namespace}
                    </TableCell>
                    <TableCell className="font-medium">{pool.name}</TableCell>
                    <TableCell>{replicas ?? "—"}</TableCell>
                    <TableCell>
                      <LabelsCell labels={pool.labels} />
                    </TableCell>
                    <TableCell title={formatDateTime(pool.creationTimestamp)}>
                      {formatAge(pool.creationTimestamp)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Pool actions"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setSelected(pool)}>
                            <Eye />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleteTarget(pool)}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CreatePoolDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        namespaces={namespaces}
      />

      <K8sObjectDetailsDialog
        object={selected}
        kind="WorkerPool"
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete pool{" "}
              {deleteTarget
                ? `${deleteTarget.namespace}/${deleteTarget.name}`
                : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the WorkerPool CRD and its backing Deployment — the
              pool&apos;s workers are freed, and running actors on them will be
              suspended or lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget)
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
