import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Info, Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { specFromYaml } from "@/lib/k8s"
import {
  PINNED_PAUSE_IMAGE,
  templatePresets,
  type EnvRow,
  type LabelRow,
} from "@/lib/presets"
import type { CreateK8sObjectRequest } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

const BLANK_PRESET = "blank"

type SnapshotKind = "Full" | "Data"

interface VolumeRow {
  name: string
  durableDir: boolean
}

function newLiteralEnv(): EnvRow {
  return { name: "", mode: "literal", value: "", secretName: "", secretKey: "" }
}

export function CreateTemplateDialog({
  open,
  onOpenChange,
  namespaces,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  namespaces: string[]
}) {
  const queryClient = useQueryClient()
  const [presetId, setPresetId] = useState(BLANK_PRESET)
  const [mode, setMode] = useState<"form" | "yaml">("form")
  const [namespace, setNamespace] = useState("")
  const [name, setName] = useState("")
  const [pauseImage, setPauseImage] = useState(PINNED_PAUSE_IMAGE)
  const [sandboxClass, setSandboxClass] = useState("")
  const [containerName, setContainerName] = useState("")
  const [containerImage, setContainerImage] = useState("")
  const [containerCommand, setContainerCommand] = useState("")
  const [readyzPath, setReadyzPath] = useState("")
  const [readyzPort, setReadyzPort] = useState("")
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [labels, setLabels] = useState<LabelRow[]>([])
  const [onPause, setOnPause] = useState<SnapshotKind>("Full")
  const [onCommit, setOnCommit] = useState<SnapshotKind>("Full")
  const [location, setLocation] = useState("")
  const [volumes, setVolumes] = useState<VolumeRow[]>([])
  const [yamlText, setYamlText] = useState("")
  const [yamlError, setYamlError] = useState("")

  const formNamespace = namespace.trim()
  // Secrets of the namespace currently typed into the form — refetches
  // automatically when the namespace changes (query key).
  const secretsQuery = useQuery({
    queryKey: ["secrets", formNamespace],
    queryFn: () => api.listSecrets(formNamespace),
    enabled: open && formNamespace !== "",
    retry: false,
  })
  const secrets = secretsQuery.data?.items ?? []

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setPresetId(BLANK_PRESET)
      setMode("form")
      setNamespace("")
      setName("")
      setPauseImage(PINNED_PAUSE_IMAGE)
      setSandboxClass("")
      setContainerName("")
      setContainerImage("")
      setContainerCommand("")
      setReadyzPath("")
      setReadyzPort("")
      setEnvRows([])
      setLabels([])
      setOnPause("Full")
      setOnCommit("Full")
      setLocation("")
      setVolumes([])
      setYamlText("")
      setYamlError("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: (req: CreateK8sObjectRequest) => api.createActorTemplate(req),
    onSuccess: (object) => {
      toast.success("Template created", {
        description: `${object.namespace}/${object.name} — golden snapshot build starts on the cluster; watch its status for progress.`,
      })
      void queryClient.invalidateQueries({ queryKey: ["actortemplates"] })
      onOpenChange(false)
    },
    onError: (error) => {
      // The k8s API server returns useful schema errors — show them verbatim.
      toast.error("Failed to create template", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const activePreset = templatePresets.find((preset) => preset.id === presetId)

  function applyPreset(id: string) {
    setPresetId(id)
    setMode("form")
    const preset = templatePresets.find((p) => p.id === id)
    setContainerName(preset?.containerName ?? "")
    setContainerImage(preset?.containerImage ?? "")
    setContainerCommand(preset?.containerCommand ?? "")
    setReadyzPath(preset?.readyzPath ?? "")
    setReadyzPort(preset?.readyzPort ?? "")
    setEnvRows(preset?.env?.map((row) => ({ ...row })) ?? [])
    setLabels(preset?.workerSelector?.map((row) => ({ ...row })) ?? [])
  }

  function updateEnv(index: number, patch: Partial<EnvRow>) {
    setEnvRows(
      envRows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  function secretKeys(secretName: string): string[] {
    return secrets.find((secret) => secret.name === secretName)?.keys ?? []
  }

  const containerTouched =
    containerName.trim() !== "" ||
    containerImage.trim() !== "" ||
    containerCommand.trim() !== "" ||
    readyzPath.trim() !== "" ||
    readyzPort.trim() !== "" ||
    envRows.some((row) => row.name.trim() !== "")

  const canSubmit =
    !mutation.isPending &&
    namespace.trim() !== "" &&
    name.trim() !== "" &&
    (mode === "yaml"
      ? yamlText.trim() !== ""
      : pauseImage.trim() !== "" &&
        location.trim() !== "" &&
        (!containerTouched ||
          (containerName.trim() !== "" && containerImage.trim() !== "")))

  function buildFormSpec(): Record<string, unknown> {
    const spec: Record<string, unknown> = {
      pauseImage: pauseImage.trim(),
      snapshotsConfig: {
        onPause,
        onCommit,
        location: location.trim(),
      },
    }
    if (sandboxClass.trim() !== "") {
      spec.sandboxClass = sandboxClass.trim()
    }
    if (containerTouched) {
      const container: Record<string, unknown> = {
        name: containerName.trim(),
        image: containerImage.trim(),
      }
      if (containerCommand.trim() !== "") {
        container.command = containerCommand.trim().split(/\s+/)
      }
      if (readyzPath.trim() !== "" && readyzPort.trim() !== "") {
        container.readyz = {
          httpGet: {
            path: readyzPath.trim(),
            port: Number(readyzPort.trim()),
          },
        }
      }
      const env = envRows
        .filter((row) => row.name.trim() !== "")
        .filter(
          (row) =>
            row.mode === "literal" ||
            (row.secretName !== "" && row.secretKey !== ""),
        )
        .map((row) =>
          row.mode === "literal"
            ? { name: row.name.trim(), value: row.value }
            : {
                name: row.name.trim(),
                valueFrom: {
                  secretKeyRef: { name: row.secretName, key: row.secretKey },
                },
              },
        )
      if (env.length > 0) {
        container.env = env
      }
      spec.containers = [container]
    }
    const matchLabels = Object.fromEntries(
      labels
        .map((row) => [row.key.trim(), row.value.trim()])
        .filter(([key, value]) => key !== "" && value !== ""),
    )
    if (Object.keys(matchLabels).length > 0) {
      spec.workerSelector = { matchLabels }
    }
    const declaredVolumes = volumes.filter((row) => row.name.trim() !== "")
    if (declaredVolumes.length > 0) {
      spec.volumes = declaredVolumes.map((row) =>
        row.durableDir
          ? { name: row.name.trim(), durableDir: {} }
          : { name: row.name.trim() },
      )
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
        spec: parsed.spec,
      })
      return
    }

    mutation.mutate({
      namespace: namespace.trim(),
      name: name.trim(),
      spec: buildFormSpec(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Template</DialogTitle>
          <DialogDescription>
            Define an ActorTemplate — the class actors are instantiated from.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Preset</Label>
            <Select value={presetId} onValueChange={applyPreset}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BLANK_PRESET}>Blank</SelectItem>
                {templatePresets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {activePreset?.info && mode === "form" && (
            <div className="flex items-start gap-2 rounded-md border bg-secondary p-3 text-sm text-secondary-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <p>{activePreset.info}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tpl-namespace">Namespace</Label>
              <Input
                id="tpl-namespace"
                placeholder="ate-demo-counter"
                list="tpl-namespaces"
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
              />
              <datalist id="tpl-namespaces">
                {namespaces.map((ns) => (
                  <option key={ns} value={ns} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                placeholder="counter"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>

          <Tabs value={mode} onValueChange={(value) => setMode(value as "form" | "yaml")}>
            <TabsList>
              <TabsTrigger value="form">Form</TabsTrigger>
              <TabsTrigger value="yaml">YAML</TabsTrigger>
            </TabsList>

            <TabsContent value="form" className="space-y-4 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tpl-pause-image">Pause image</Label>
                  <Input
                    id="tpl-pause-image"
                    className="font-mono text-xs"
                    value={pauseImage}
                    onChange={(event) => setPauseImage(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tpl-sandbox-class">
                    Sandbox class (optional)
                  </Label>
                  <Input
                    id="tpl-sandbox-class"
                    value={sandboxClass}
                    onChange={(event) => setSandboxClass(event.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Container (optional)</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tpl-container-name" className="text-xs text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      id="tpl-container-name"
                      placeholder="counter"
                      value={containerName}
                      onChange={(event) => setContainerName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tpl-container-image" className="text-xs text-muted-foreground">
                      Image
                    </Label>
                    <Input
                      id="tpl-container-image"
                      className="font-mono text-xs"
                      placeholder={
                        activePreset?.containerImagePlaceholder ??
                        "ko://github.com/agent-substrate/substrate/demos/counter"
                      }
                      value={containerImage}
                      onChange={(event) => setContainerImage(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tpl-container-command" className="text-xs text-muted-foreground">
                    Command (space-separated)
                  </Label>
                  <Input
                    id="tpl-container-command"
                    className="font-mono text-xs"
                    placeholder="/ko-app/counter"
                    value={containerCommand}
                    onChange={(event) =>
                      setContainerCommand(event.target.value)
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tpl-readyz-path" className="text-xs text-muted-foreground">
                      Readyz path (optional)
                    </Label>
                    <Input
                      id="tpl-readyz-path"
                      className="font-mono text-xs"
                      placeholder="/readyz"
                      value={readyzPath}
                      onChange={(event) => setReadyzPath(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tpl-readyz-port" className="text-xs text-muted-foreground">
                      Readyz port (optional)
                    </Label>
                    <Input
                      id="tpl-readyz-port"
                      inputMode="numeric"
                      placeholder="80"
                      value={readyzPort}
                      onChange={(event) => setReadyzPort(event.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Environment variables (optional)
                  </Label>
                  {envRows.map((row, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <Input
                        className="w-40 font-mono text-xs"
                        placeholder="NAME"
                        value={row.name}
                        onChange={(event) =>
                          updateEnv(index, { name: event.target.value })
                        }
                      />
                      <Select
                        value={row.mode}
                        onValueChange={(value) =>
                          updateEnv(index, { mode: value as EnvRow["mode"] })
                        }
                      >
                        <SelectTrigger className="w-30">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="literal">Literal</SelectItem>
                          <SelectItem value="secret">Secret ref</SelectItem>
                        </SelectContent>
                      </Select>
                      {row.mode === "literal" ? (
                        <Input
                          className="min-w-40 flex-1"
                          placeholder="value"
                          value={row.value}
                          onChange={(event) =>
                            updateEnv(index, { value: event.target.value })
                          }
                        />
                      ) : (
                        <>
                          <Select
                            value={row.secretName}
                            onValueChange={(value) =>
                              updateEnv(index, {
                                secretName: value,
                                secretKey: "",
                              })
                            }
                          >
                            <SelectTrigger className="min-w-32 flex-1">
                              <SelectValue placeholder="secret" />
                            </SelectTrigger>
                            <SelectContent>
                              {secrets.map((secret) => (
                                <SelectItem key={secret.name} value={secret.name}>
                                  {secret.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={row.secretKey}
                            onValueChange={(value) =>
                              updateEnv(index, { secretKey: value })
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="key" />
                            </SelectTrigger>
                            <SelectContent>
                              {secretKeys(row.secretName).map((key) => (
                                <SelectItem key={key} value={key}>
                                  {key}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove env var"
                        onClick={() =>
                          setEnvRows(envRows.filter((_, i) => i !== index))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {envRows.some((row) => row.mode === "secret") &&
                    (formNamespace === "" ? (
                      <p className="text-xs text-muted-foreground">
                        Enter a namespace above to load its secrets.
                      </p>
                    ) : (
                      !secretsQuery.isLoading &&
                      (secretsQuery.isError || secrets.length === 0) && (
                        <p className="text-xs text-muted-foreground">
                          No secrets available in namespace &quot;
                          {formNamespace}&quot; — create one on the{" "}
                          <Link to="/secrets" className="text-primary underline">
                            Secrets page
                          </Link>
                          .
                        </p>
                      )
                    ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEnvRows([...envRows, newLiteralEnv()])}
                  >
                    <Plus className="size-4" />
                    Add env var
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Worker selector labels (optional)</Label>
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

              <div className="space-y-3">
                <Label>Snapshots config</Label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      On pause
                    </Label>
                    <Select
                      value={onPause}
                      onValueChange={(value) => setOnPause(value as SnapshotKind)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Full">Full</SelectItem>
                        <SelectItem value="Data">Data</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      On commit
                    </Label>
                    <Select
                      value={onCommit}
                      onValueChange={(value) => setOnCommit(value as SnapshotKind)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Full">Full</SelectItem>
                        <SelectItem value="Data">Data</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tpl-location" className="text-xs text-muted-foreground">
                      Location
                    </Label>
                    <Input
                      id="tpl-location"
                      className="font-mono text-xs"
                      placeholder="gs://bucket/prefix/"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Volumes (optional)</Label>
                {volumes.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="name"
                      value={row.name}
                      onChange={(event) =>
                        setVolumes(
                          volumes.map((volume, i) =>
                            i === index
                              ? { ...volume, name: event.target.value }
                              : volume,
                          ),
                        )
                      }
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <Checkbox
                        id={`tpl-volume-durable-${index}`}
                        checked={row.durableDir}
                        onCheckedChange={(checked) =>
                          setVolumes(
                            volumes.map((volume, i) =>
                              i === index
                                ? { ...volume, durableDir: checked === true }
                                : volume,
                            ),
                          )
                        }
                      />
                      <Label
                        htmlFor={`tpl-volume-durable-${index}`}
                        className="text-xs font-normal text-muted-foreground"
                      >
                        durableDir
                      </Label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove volume"
                      onClick={() =>
                        setVolumes(volumes.filter((_, i) => i !== index))
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
                    setVolumes([...volumes, { name: "", durableDir: true }])
                  }
                >
                  <Plus className="size-4" />
                  Add volume
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="yaml" className="space-y-2 pt-2">
              <Label htmlFor="tpl-yaml">Spec YAML</Label>
              <Textarea
                id="tpl-yaml"
                className="min-h-64 font-mono text-xs"
                placeholder={
                  "pauseImage: registry.k8s.io/pause:3.10.2@sha256:f548e0e8e3dc1896ca956272154dde3314e8cc4fde0a57577ee9fa1c63f5baf4\nsnapshotsConfig:\n  onPause: Full\n  onCommit: Full\n  location: gs://bucket/prefix/\n\n# …or paste a full ActorTemplate manifest"
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
                  metadata.namespace/name override the fields above.
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
