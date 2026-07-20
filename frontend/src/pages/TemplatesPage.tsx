import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { formatAge, formatDateTime } from "@/lib/format"
import { containerImages } from "@/lib/k8s"
import type { K8sObject } from "@/lib/types"
import { CreateTemplateDialog } from "@/components/CreateTemplateDialog"
import { K8sObjectDetailsDialog } from "@/components/K8sObjectDetailsDialog"
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
import { Badge } from "@/components/ui/badge"
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

function ImagesCell({ object }: { object: K8sObject }) {
  const images = containerImages(object)
  if (images.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  const shown = images.slice(0, 2)
  return (
    <div
      className="flex max-w-72 flex-wrap items-center gap-1"
      title={images.join("\n")}
    >
      {shown.map((image) => (
        <Badge
          key={image}
          variant="secondary"
          className="max-w-56 truncate font-mono text-xs"
        >
          {image}
        </Badge>
      ))}
      {images.length > 2 && (
        <Badge variant="outline" className="text-xs">
          +{images.length - 2}
        </Badge>
      )}
    </div>
  )
}

export default function TemplatesPage() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<K8sObject | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<K8sObject | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const templatesQuery = useQuery({
    queryKey: ["actortemplates"],
    queryFn: api.listActorTemplates,
    refetchInterval: 5000,
    retry: false,
  })
  const items = templatesQuery.data?.items
  const templates = items ?? []
  const namespaces = useMemo(
    () => [...new Set((items ?? []).map((item) => item.namespace))].sort(),
    [items],
  )

  const deleteMutation = useMutation({
    mutationFn: (target: K8sObject) =>
      api.deleteActorTemplate(target.namespace, target.name),
    onSuccess: (_data, target) => {
      toast.success("Template deleted", {
        description: `${target.namespace}/${target.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["actortemplates"] })
      setDeleteTarget(null)
    },
    onError: (error) => {
      toast.error("Failed to delete template", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  return (
    <>
      <PageHeader
        title="Templates"
        description="ActorTemplate CRDs that actors are instantiated from."
      >
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Create Template
        </Button>
      </PageHeader>

      {templatesQuery.isLoading ? (
        <TableSkeleton columns={5} />
      ) : templatesQuery.isError ? (
        <WarningState
          title="ActorTemplates unavailable"
          message={`The backend may not have cluster access. ${
            templatesQuery.error instanceof Error
              ? templatesQuery.error.message
              : ""
          }`}
        />
      ) : templates.length === 0 ? (
        <EmptyState
          title="No ActorTemplates found"
          description="Create one here, or apply ActorTemplate CRDs to the cluster."
          action={
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              Create Template
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
                <TableHead>Images</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={`${template.namespace}/${template.name}`}>
                  <TableCell className="text-muted-foreground">
                    {template.namespace}
                  </TableCell>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    <ImagesCell object={template} />
                  </TableCell>
                  <TableCell title={formatDateTime(template.creationTimestamp)}>
                    {formatAge(template.creationTimestamp)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Template actions"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setSelected(template)}>
                          <Eye />
                          View details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTarget(template)}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        namespaces={namespaces}
      />

      <K8sObjectDetailsDialog
        object={selected}
        kind="ActorTemplate"
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
              Delete template{" "}
              {deleteTarget
                ? `${deleteTarget.namespace}/${deleteTarget.name}`
                : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the ActorTemplate CRD from the cluster. Deleting a
              template does not delete its actors.
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
