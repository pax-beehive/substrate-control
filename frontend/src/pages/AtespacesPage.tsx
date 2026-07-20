import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { formatAge, formatDateTime, truncateMiddle } from "@/lib/format"
import type { Atespace } from "@/lib/types"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function CreateAtespaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")

  const mutation = useMutation({
    mutationFn: (value: string) => api.createAtespace(value),
    onSuccess: (space) => {
      toast.success("Atespace created", { description: space.name })
      void queryClient.invalidateQueries({ queryKey: ["atespaces"] })
      setName("")
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error("Failed to create atespace", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const value = name.trim()
    if (value === "" || mutation.isPending) return
    mutation.mutate(value)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Atespace</DialogTitle>
          <DialogDescription>
            An atespace is an isolation namespace for actors.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="atespace-name">Name</Label>
            <Input
              id="atespace-name"
              placeholder="my-space"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={name.trim() === "" || mutation.isPending}
            >
              {mutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function AtespacesPage() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Atespace | null>(null)

  const atespacesQuery = useQuery({
    queryKey: ["atespaces"],
    queryFn: api.listAtespaces,
    refetchInterval: 5000,
  })
  const atespaces = atespacesQuery.data?.atespaces ?? []

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.deleteAtespace(name),
    onSuccess: (space) => {
      toast.success("Atespace deleted", { description: space.name })
      void queryClient.invalidateQueries({ queryKey: ["atespaces"] })
      void queryClient.invalidateQueries({ queryKey: ["actors"] })
      setDeleteTarget(null)
    },
    onError: (error) => {
      // The server rejects deletion of non-empty atespaces.
      toast.error("Failed to delete atespace", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  return (
    <>
      <PageHeader
        title="Atespaces"
        description="Isolation namespaces that actors belong to."
      >
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Create Atespace
        </Button>
      </PageHeader>

      {atespacesQuery.isLoading ? (
        <TableSkeleton columns={5} />
      ) : atespacesQuery.isError ? (
        <ErrorState
          title="Failed to load atespaces"
          error={atespacesQuery.error}
        />
      ) : atespaces.length === 0 ? (
        <EmptyState
          title="No atespaces yet — create one"
          action={
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              Create Atespace
            </Button>
          }
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>UID</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {atespaces.map((space) => (
                <TableRow key={space.name}>
                  <TableCell className="font-medium">{space.name}</TableCell>
                  <TableCell
                    className="font-mono text-xs text-muted-foreground"
                    title={space.uid}
                  >
                    {truncateMiddle(space.uid)}
                  </TableCell>
                  <TableCell>{space.version}</TableCell>
                  <TableCell title={formatDateTime(space.createTime)}>
                    {formatAge(space.createTime)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${space.name}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => setDeleteTarget(space)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateAtespaceDialog open={createOpen} onOpenChange={setCreateOpen} />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete atespace {deleteTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deleting an atespace fails on the server while it still contains
              actors.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.name)
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
