import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { formatAge, formatCountdown, formatDateTime } from "@/lib/format"
import type { GatewayKey, GatewayModel } from "@/lib/types"
import { GenerateKeyDialog } from "@/components/GenerateKeyDialog"
import { RegisterModelDialog } from "@/components/RegisterModelDialog"
import {
  EmptyState,
  ErrorState,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

function maskKey(key: string): string {
  return key.length <= 8 ? key : `${key.slice(0, 8)}…`
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`
}

export default function GatewayPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState("keys")
  const [generateOpen, setGenerateOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [deleteKeyTarget, setDeleteKeyTarget] = useState<GatewayKey | null>(null)
  const [deleteModelTarget, setDeleteModelTarget] =
    useState<GatewayModel | null>(null)

  const infoQuery = useQuery({
    queryKey: ["gatewayInfo"],
    queryFn: api.getGatewayInfo,
    retry: false,
  })
  const info = infoQuery.data
  const reachable = info?.reachable === true

  const keysQuery = useQuery({
    queryKey: ["gatewayKeys"],
    queryFn: api.listGatewayKeys,
    enabled: reachable,
    refetchInterval: 5000,
    retry: false,
  })
  const keys = keysQuery.data?.items ?? []

  const modelsQuery = useQuery({
    queryKey: ["gatewayModels"],
    queryFn: api.listGatewayModels,
    enabled: reachable,
    refetchInterval: 5000,
    retry: false,
  })
  const models = modelsQuery.data?.items ?? []

  const deleteKeyMutation = useMutation({
    mutationFn: (key: GatewayKey) => api.deleteGatewayKey(key.key),
    onSuccess: (_data, key) => {
      toast.success("Key deleted", {
        description: key.keyAlias || maskKey(key.key),
      })
      void queryClient.invalidateQueries({ queryKey: ["gatewayKeys"] })
      setDeleteKeyTarget(null)
    },
    onError: (error) => {
      toast.error("Failed to delete key", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const deleteModelMutation = useMutation({
    mutationFn: (model: GatewayModel) => api.deleteGatewayModel(model.id),
    onSuccess: (_data, model) => {
      toast.success("Model deleted", { description: model.modelName })
      void queryClient.invalidateQueries({ queryKey: ["gatewayModels"] })
      setDeleteModelTarget(null)
    },
    onError: (error) => {
      toast.error("Failed to delete model", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const gatewayError =
    infoQuery.error instanceof Error ? infoQuery.error.message : ""

  return (
    <>
      <PageHeader
        title="LLM Gateway"
        description="LiteLLM virtual API keys and upstream models for agent workloads."
      >
        {tab === "keys" ? (
          <Button onClick={() => setGenerateOpen(true)} disabled={!reachable}>
            <Plus />
            Generate Key
          </Button>
        ) : (
          <Button onClick={() => setRegisterOpen(true)} disabled={!reachable}>
            <Plus />
            Register Model
          </Button>
        )}
      </PageHeader>

      {infoQuery.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Checking gateway…
        </p>
      ) : infoQuery.isError || !reachable ? (
        <WarningState
          title="Gateway unreachable"
          message={
            gatewayError !== ""
              ? `Gateway unreachable (${gatewayError})`
              : "Gateway unreachable."
          }
        />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-[#2F7D4F]" />
          connected · {info.version}
          <span className="text-muted-foreground/60">· {info.url}</span>
        </p>
      )}

      {reachable && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="keys">Virtual Keys</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
          </TabsList>

          <TabsContent value="keys" className="mt-4">
            {keysQuery.isLoading ? (
              <TableSkeleton columns={7} />
            ) : keysQuery.isError ? (
              <ErrorState title="Failed to load keys" error={keysQuery.error} />
            ) : keys.length === 0 ? (
              <EmptyState
                title="No keys yet — generate one"
                action={
                  <Button variant="outline" onClick={() => setGenerateOpen(true)}>
                    <Plus />
                    Generate Key
                  </Button>
                }
              />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alias</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Models</TableHead>
                      <TableHead>Spend / Budget</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key) => {
                      const expires = formatCountdown(key.expires)
                      const keyModels = key.models ?? []
                      return (
                        <TableRow key={key.key}>
                          <TableCell className="font-medium">
                            {key.keyAlias || "—"}
                          </TableCell>
                          <TableCell
                            className="font-mono text-xs text-muted-foreground"
                            title={key.key}
                          >
                            {maskKey(key.key)}
                          </TableCell>
                          <TableCell>
                            {keyModels.length === 0 ? (
                              <span className="text-muted-foreground">all</span>
                            ) : (
                              <div className="flex max-w-56 flex-wrap gap-1">
                                {keyModels.slice(0, 2).map((model) => (
                                  <Badge
                                    key={model}
                                    variant="secondary"
                                    className="font-mono text-xs"
                                  >
                                    {model}
                                  </Badge>
                                ))}
                                {keyModels.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{keyModels.length - 2}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {usd(key.spend)} /{" "}
                            {key.maxBudget > 0 ? usd(key.maxBudget) : "—"}
                          </TableCell>
                          <TableCell
                            title={formatDateTime(key.expires)}
                            className={cn(
                              expires === "expired" && "text-destructive",
                            )}
                          >
                            {expires}
                          </TableCell>
                          <TableCell title={formatDateTime(key.createdAt)}>
                            {formatAge(key.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${key.keyAlias || maskKey(key.key)}`}
                              disabled={deleteKeyMutation.isPending}
                              onClick={() => setDeleteKeyTarget(key)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="models" className="mt-4">
            {modelsQuery.isLoading ? (
              <TableSkeleton columns={7} />
            ) : modelsQuery.isError ? (
              <ErrorState
                title="Failed to load models"
                error={modelsQuery.error}
              />
            ) : models.length === 0 ? (
              <EmptyState
                title="No models registered — register your first upstream model"
                action={
                  <Button variant="outline" onClick={() => setRegisterOpen(true)}>
                    <Plus />
                    Register Model
                  </Button>
                }
              />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model Name</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>API Base</TableHead>
                      <TableHead>API Key</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {models.map((model) => (
                      <TableRow key={model.id}>
                        <TableCell className="font-mono text-sm font-medium">
                          {model.modelName}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{model.provider}</Badge>
                        </TableCell>
                        <TableCell
                          className="max-w-56 truncate font-mono text-xs text-muted-foreground"
                          title={model.model}
                        >
                          {model.model}
                        </TableCell>
                        <TableCell
                          className="max-w-44 truncate font-mono text-xs text-muted-foreground"
                          title={model.apiBase}
                        >
                          {model.apiBase || "—"}
                        </TableCell>
                        <TableCell>
                          {model.hasApiKey ? (
                            <Badge
                              variant="outline"
                              className="border-[#BFDCC7] bg-[#E6F2E8] text-[#2F7D4F] dark:border-[#2F7D4F]/40 dark:bg-[#2F7D4F]/15 dark:text-[#8FC7A6]"
                            >
                              <Check className="size-3" />
                              set
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell title={formatDateTime(model.createdAt)}>
                          {formatAge(model.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${model.modelName}`}
                            disabled={deleteModelMutation.isPending}
                            onClick={() => setDeleteModelTarget(model)}
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
          </TabsContent>
        </Tabs>
      )}

      <GenerateKeyDialog open={generateOpen} onOpenChange={setGenerateOpen} />
      <RegisterModelDialog open={registerOpen} onOpenChange={setRegisterOpen} />

      <AlertDialog
        open={deleteKeyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteKeyTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete key {deleteKeyTarget?.keyAlias || ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This revokes the virtual key at the gateway. Workloads using it
              lose LLM access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteKeyMutation.isPending}
              onClick={() => {
                if (deleteKeyTarget) deleteKeyMutation.mutate(deleteKeyTarget)
              }}
            >
              {deleteKeyMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteModelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteModelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete model {deleteModelTarget?.modelName || ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the upstream model from the gateway. Virtual keys
              scoped to this model lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteModelMutation.isPending}
              onClick={() => {
                if (deleteModelTarget)
                  deleteModelMutation.mutate(deleteModelTarget)
              }}
            >
              {deleteModelMutation.isPending && (
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
