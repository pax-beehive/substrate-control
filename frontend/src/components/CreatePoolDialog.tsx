import { useEffect, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Info, Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { specFromYaml } from "@/lib/k8s"
import type { LabelRow } from "@/lib/presets"
import type { CreateK8sObjectRequest } from "@/lib/types"
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
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

export function CreatePoolDialog({
  open,
  onOpenChange,
  namespaces,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  namespaces: string[]
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<"form" | "yaml">("form")
  const [namespace, setNamespace] = useState("")
  const [name, setName] = useState("")
  const [labels, setLabels] = useState<LabelRow[]>([])
  const [replicas, setReplicas] = useState("2")
  const [ateomImage, setAteomImage] = useState("")
  const [sandboxClass, setSandboxClass] = useState("")
  const [sandboxConfigName, setSandboxConfigName] = useState("")
  const [requestsCpu, setRequestsCpu] = useState("")
  const [requestsMemory, setRequestsMemory] = useState("")
  const [limitsCpu, setLimitsCpu] = useState("")
  const [limitsMemory, setLimitsMemory] = useState("")
  const [nodeSelector, setNodeSelector] = useState<LabelRow[]>([])
  const [yamlText, setYamlText] = useState("")
  const [yamlError, setYamlError] = useState("")

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setMode("form")
      setNamespace("")
      setName("")
      setLabels([])
      setReplicas("2")
      setAteomImage("")
      setSandboxClass("")
      setSandboxConfigName("")
      setRequestsCpu("")
      setRequestsMemory("")
      setLimitsCpu("")
      setLimitsMemory("")
      setNodeSelector([])
      setYamlText("")
      setYamlError("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: (req: CreateK8sObjectRequest) => api.createWorkerPool(req),
    onSuccess: (object) => {
      toast.success("WorkerPool created", {
        description: `${object.namespace}/${object.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["workerpools"] })
      onOpenChange(false)
    },
    onError: (error) => {
      // The k8s API server returns useful schema errors — show them verbatim.
      toast.error("Failed to create pool", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const replicaCount = Number(replicas)
  const replicasValid = Number.isInteger(replicaCount) && replicaCount >= 1

  const metadataLabels = Object.fromEntries(
    labels
      .map((row) => [row.key.trim(), row.value.trim()])
      .filter(([key, value]) => key !== "" && value !== ""),
  )

  const canSubmit =
    !mutation.isPending &&
    namespace.trim() !== "" &&
    name.trim() !== "" &&
    (mode === "yaml"
      ? yamlText.trim() !== ""
      : ateomImage.trim() !== "" && replicasValid)

  function buildFormSpec(): Record<string, unknown> {
    const spec: Record<string, unknown> = {
      ateomImage: ateomImage.trim(),
      replicas: replicaCount,
    }
    if (sandboxClass.trim() !== "") {
      spec.sandboxClass = sandboxClass.trim()
    }
    if (sandboxConfigName.trim() !== "") {
      spec.sandboxConfigName = sandboxConfigName.trim()
    }
    const requests: Record<string, string> = {}
    if (requestsCpu.trim() !== "") requests.cpu = requestsCpu.trim()
    if (requestsMemory.trim() !== "") requests.memory = requestsMemory.trim()
    const limits: Record<string, string> = {}
    if (limitsCpu.trim() !== "") limits.cpu = limitsCpu.trim()
    if (limitsMemory.trim() !== "") limits.memory = limitsMemory.trim()
    const nodeSelectorMap = Object.fromEntries(
      nodeSelector
        .map((row) => [row.key.trim(), row.value.trim()])
        .filter(([key, value]) => key !== "" && value !== ""),
    )
    const template: Record<string, unknown> = {}
    if (Object.keys(requests).length > 0 || Object.keys(limits).length > 0) {
      template.resources = {
        ...(Object.keys(requests).length > 0 ? { requests } : {}),
        ...(Object.keys(limits).length > 0 ? { limits } : {}),
      }
    }
    if (Object.keys(nodeSelectorMap).length > 0) {
      template.nodeSelector = nodeSelectorMap
    }
    if (Object.keys(template).length > 0) {
      spec.template = template
    }
    return spec
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    if (mode === "yaml") {
      let parsed: ReturnType<typeof specFromYaml>
      try {
        parsed = specFromYaml(yamlText)
      } catch (error) {
        setYamlError(error instanceof Error ? error.message : "Invalid YAML")
        return
      }
      const resolvedNamespace = parsed.namespace ?? namespace.trim()
      const resolvedName = parsed.name ?? name.trim()
      if (resolvedNamespace === "" || resolvedName === "") {
        setYamlError(
          "Namespace and name are required — fill them in above or use a full manifest with metadata.",
        )
        return
      }
      mutation.mutate({
        namespace: resolvedNamespace,
        name: resolvedName,
        ...(parsed.labels ? { labels: parsed.labels } : {}),
        spec: parsed.spec,
      })
      return
    }

    mutation.mutate({
      namespace: namespace.trim(),
      name: name.trim(),
      ...(Object.keys(metadataLabels).length > 0
        ? { labels: metadataLabels }
        : {}),
      spec: buildFormSpec(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Pool</DialogTitle>
          <DialogDescription>
            Declare warm compute capacity — a fleet of pre-started workers
            actors get scheduled onto.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pool-namespace">Namespace</Label>
              <Input
                id="pool-namespace"
                placeholder="ate-demo-counter"
                list="pool-namespaces"
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
              />
              <datalist id="pool-namespaces">
                {namespaces.map((ns) => (
                  <option key={ns} value={ns} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pool-name">Name</Label>
              <Input
                id="pool-name"
                placeholder="claude-workers"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>

          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as "form" | "yaml")}
          >
            <TabsList>
              <TabsTrigger value="form">Form</TabsTrigger>
              <TabsTrigger value="yaml">YAML</TabsTrigger>
            </TabsList>

            <TabsContent value="form" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Metadata labels</Label>
                <div className="flex items-start gap-2 rounded-md border bg-secondary p-3 text-sm text-secondary-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p>
                    ActorTemplates find pools through these labels: a
                    template&apos;s workerSelector.matchLabels must match this
                    pool&apos;s metadata labels (e.g. workload=claude-multiplex).
                  </p>
                </div>
                {labels.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="key"
                      value={row.key}
                      onChange={(event) =>
                        setLabels(
                          labels.map((label, i) =>
                            i === index
                              ? { ...label, key: event.target.value }
                              : label,
                          ),
                        )
                      }
                    />
                    <span className="text-muted-foreground">=</span>
                    <Input
                      placeholder="value"
                      value={row.value}
                      onChange={(event) =>
                        setLabels(
                          labels.map((label, i) =>
                            i === index
                              ? { ...label, value: event.target.value }
                              : label,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove label"
                      onClick={() =>
                        setLabels(labels.filter((_, i) => i !== index))
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLabels([...labels, { key: "", value: "" }])}
                >
                  <Plus className="size-4" />
                  Add label
                </Button>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="pool-ateom-image">Ateom image</Label>
                <Input
                  id="pool-ateom-image"
                  className="font-mono text-xs"
                  placeholder="localhost:32000/ateom-gvisor@sha256:... (must exist in a registry the cluster can pull)"
                  value={ateomImage}
                  onChange={(event) => setAteomImage(event.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="pool-replicas">Replicas</Label>
                  <Input
                    id="pool-replicas"
                    type="number"
                    min={1}
                    value={replicas}
                    onChange={(event) => setReplicas(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pool-sandbox-class">
                    Sandbox class (optional)
                  </Label>
                  <Input
                    id="pool-sandbox-class"
                    placeholder="gvisor"
                    value={sandboxClass}
                    onChange={(event) => setSandboxClass(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pool-sandbox-config">
                    Sandbox config (optional)
                  </Label>
                  <Input
                    id="pool-sandbox-config"
                    list="pool-sandbox-configs"
                    placeholder="gvisor-default"
                    value={sandboxConfigName}
                    onChange={(event) =>
                      setSandboxConfigName(event.target.value)
                    }
                  />
                  <datalist id="pool-sandbox-configs">
                    <option value="gvisor-default" />
                  </datalist>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Resources (optional)</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pool-req-cpu" className="text-xs text-muted-foreground">
                      Requests CPU
                    </Label>
                    <Input
                      id="pool-req-cpu"
                      placeholder="500m"
                      value={requestsCpu}
                      onChange={(event) => setRequestsCpu(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pool-req-mem" className="text-xs text-muted-foreground">
                      Requests memory
                    </Label>
                    <Input
                      id="pool-req-mem"
                      placeholder="512Mi"
                      value={requestsMemory}
                      onChange={(event) =>
                        setRequestsMemory(event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pool-lim-cpu" className="text-xs text-muted-foreground">
                      Limits CPU
                    </Label>
                    <Input
                      id="pool-lim-cpu"
                      placeholder="1"
                      value={limitsCpu}
                      onChange={(event) => setLimitsCpu(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pool-lim-mem" className="text-xs text-muted-foreground">
                      Limits memory
                    </Label>
                    <Input
                      id="pool-lim-mem"
                      placeholder="1Gi"
                      value={limitsMemory}
                      onChange={(event) => setLimitsMemory(event.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Node selector (optional)</Label>
                {nodeSelector.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="key"
                      value={row.key}
                      onChange={(event) =>
                        setNodeSelector(
                          nodeSelector.map((entry, i) =>
                            i === index
                              ? { ...entry, key: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                    <span className="text-muted-foreground">=</span>
                    <Input
                      placeholder="value"
                      value={row.value}
                      onChange={(event) =>
                        setNodeSelector(
                          nodeSelector.map((entry, i) =>
                            i === index
                              ? { ...entry, value: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove node selector"
                      onClick={() =>
                        setNodeSelector(nodeSelector.filter((_, i) => i !== index))
                      }
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
                    setNodeSelector([...nodeSelector, { key: "", value: "" }])
                  }
                >
                  <Plus className="size-4" />
                  Add node selector
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="yaml" className="space-y-2 pt-2">
              <Label htmlFor="pool-yaml">Spec YAML</Label>
              <Textarea
                id="pool-yaml"
                className="min-h-64 font-mono text-xs"
                placeholder={
                  "ateomImage: localhost:32000/ateom-gvisor@sha256:...\nreplicas: 2\n\n# …or paste a full WorkerPool manifest (metadata.labels included)"
                }
                value={yamlText}
                onChange={(event) => {
                  setYamlText(event.target.value)
                  setYamlError("")
                }}
              />
              {yamlError !== "" ? (
                <p className="text-sm break-words text-destructive">
                  {yamlError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paste a bare spec or a full manifest. A manifest&apos;s
                  metadata.namespace/name/labels override the fields above.
                </p>
              )}
            </TabsContent>
          </Tabs>

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
