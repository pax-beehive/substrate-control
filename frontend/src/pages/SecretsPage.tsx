import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, EyeOff, Loader2, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { formatAge, formatDateTime } from "@/lib/format"
import type { SecretInfo } from "@/lib/types"
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

interface DataRow {
  key: string
  value: string
  show: boolean
}

function CreateSecretDialog({
  open,
  onOpenChange,
  initialNamespace,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialNamespace: string
}) {
  const queryClient = useQueryClient()
  const [namespace, setNamespace] = useState(initialNamespace)
  const [name, setName] = useState("")
  const [rows, setRows] = useState<DataRow[]>([{ key: "", value: "", show: false }])

  useEffect(() => {
    if (open) {
      setNamespace(initialNamespace)
      setName("")
      setRows([{ key: "", value: "", show: false }])
    }
  }, [open, initialNamespace])

  const mutation = useMutation({
    mutationFn: api.createSecret,
    onSuccess: (secret) => {
      toast.success("Secret created", {
        description: `${secret.namespace}/${secret.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["secrets"] })
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error("Failed to create secret", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const completeRows = rows.filter(
    (row) => row.key.trim() !== "" && row.value !== "",
  )
  const canSubmit =
    namespace.trim() !== "" &&
    name.trim() !== "" &&
    completeRows.length > 0 &&
    !mutation.isPending

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    mutation.mutate({
      namespace: namespace.trim(),
      name: name.trim(),
      data: Object.fromEntries(
        completeRows.map((row) => [row.key.trim(), row.value]),
      ),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Secret</DialogTitle>
          <DialogDescription>
            Opaque secret for template env refs. Values are write-only and
            never returned by the API.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="secret-namespace">Namespace</Label>
              <Input
                id="secret-namespace"
                placeholder="default"
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                placeholder="anthropic-api-key"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Data</Label>
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="key"
                  value={row.key}
                  onChange={(event) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, key: event.target.value } : r,
                      ),
                    )
                  }
                />
                <div className="relative flex-1">
                  <Input
                    type={row.show ? "text" : "password"}
                    placeholder="value"
                    className="pr-9"
                    value={row.value}
                    onChange={(event) =>
                      setRows(
                        rows.map((r, i) =>
                          i === index ? { ...r, value: event.target.value } : r,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                    aria-label={row.show ? "Hide value" : "Show value"}
                    onClick={() =>
                      setRows(
                        rows.map((r, i) =>
                          i === index ? { ...r, show: !r.show } : r,
                        ),
                      )
                    }
                  >
                    {row.show ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove row"
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows([...rows, { key: "", value: "", show: false }])
              }
            >
              <Plus className="size-4" />
              Add row
            </Button>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
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

export default function SecretsPage() {
  const queryClient = useQueryClient()
  const [namespace, setNamespace] = useState("default")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SecretInfo | null>(null)

  const activeNamespace = namespace.trim()
  const secretsQuery = useQuery({
    queryKey: ["secrets", activeNamespace],
    queryFn: () => api.listSecrets(activeNamespace),
    enabled: activeNamespace !== "",
    refetchInterval: 5000,
    retry: false,
  })
  const items = secretsQuery.data?.items
  const secrets = items ?? []
  const namespaces = useMemo(
    () => [...new Set((items ?? []).map((item) => item.namespace))].sort(),
    [items],
  )

  const deleteMutation = useMutation({
    mutationFn: (target: SecretInfo) =>
      api.deleteSecret(target.namespace, target.name),
    onSuccess: (_data, target) => {
      toast.success("Secret deleted", {
        description: `${target.namespace}/${target.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["secrets"] })
      setDeleteTarget(null)
    },
    onError: (error) => {
      toast.error("Failed to delete secret", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  return (
    <>
      <PageHeader
        title="Secrets"
        description="Opaque secrets referenced by template env vars. Values are write-only."
      >
        <Input
          className="w-44"
          placeholder="namespace"
          list="secret-namespaces"
          value={namespace}
          onChange={(event) => setNamespace(event.target.value)}
        />
        <datalist id="secret-namespaces">
          {namespaces.map((ns) => (
            <option key={ns} value={ns} />
          ))}
        </datalist>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Create Secret
        </Button>
      </PageHeader>

      {activeNamespace === "" ? (
        <EmptyState
          title="Enter a namespace"
          description="Secrets are listed per Kubernetes namespace."
        />
      ) : secretsQuery.isLoading ? (
        <TableSkeleton columns={5} />
      ) : secretsQuery.isError ? (
        <WarningState
          title="Secrets unavailable"
          message={`The backend may not have cluster access. ${
            secretsQuery.error instanceof Error ? secretsQuery.error.message : ""
          }`}
        />
      ) : secrets.length === 0 ? (
        <EmptyState
          title={`No secrets in namespace "${activeNamespace}" — create one`}
          action={
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus />
              Create Secret
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
                <TableHead>Type</TableHead>
                <TableHead>Keys</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {secrets.map((secret) => (
                <TableRow key={`${secret.namespace}/${secret.name}`}>
                  <TableCell className="text-muted-foreground">
                    {secret.namespace}
                  </TableCell>
                  <TableCell className="font-medium">{secret.name}</TableCell>
                  <TableCell>{secret.type}</TableCell>
                  <TableCell>
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {(secret.keys ?? []).map((key) => (
                        <Badge
                          key={key}
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {key}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell title={formatDateTime(secret.creationTimestamp)}>
                    {formatAge(secret.creationTimestamp)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${secret.name}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => setDeleteTarget(secret)}
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

      <CreateSecretDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialNamespace={activeNamespace || "default"}
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
              Delete secret{" "}
              {deleteTarget
                ? `${deleteTarget.namespace}/${deleteTarget.name}`
                : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Templates referencing this secret via secretKeyRef will fail to
              launch new actors until the secret is recreated.
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
