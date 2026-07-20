import { useEffect, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, KeySquare, Loader2 } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import { ApiError } from "@/lib/api"
import type { GeneratedKey } from "@/lib/types"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

const NO_EXPIRY = "none"

const durationOptions = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: NO_EXPIRY, label: "No expiry" },
]

export function GenerateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [keyAlias, setKeyAlias] = useState("")
  const [duration, setDuration] = useState(NO_EXPIRY)
  const [models, setModels] = useState("")
  const [maxBudget, setMaxBudget] = useState("")
  const [generated, setGenerated] = useState<GeneratedKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [secretNamespace, setSecretNamespace] = useState("default")
  const [secretName, setSecretName] = useState("")
  const [secretDataKey, setSecretDataKey] = useState("api-key")
  const [secretSaved, setSecretSaved] = useState(false)

  // Reset everything every time the dialog opens.
  useEffect(() => {
    if (open) {
      setKeyAlias("")
      setDuration(NO_EXPIRY)
      setModels("")
      setMaxBudget("")
      setGenerated(null)
      setCopied(false)
      setSecretNamespace("default")
      setSecretName("")
      setSecretDataKey("api-key")
      setSecretSaved(false)
    }
  }, [open])

  const generateMutation = useMutation({
    mutationFn: api.generateGatewayKey,
    onSuccess: (key) => {
      toast.success("Key generated", { description: key.keyAlias })
      void queryClient.invalidateQueries({ queryKey: ["gatewayKeys"] })
      setGenerated(key)
      setSecretName(`litellm-key-${key.keyAlias}`)
    },
    onError: (error) => {
      toast.error("Failed to generate key", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const saveSecretMutation = useMutation({
    mutationFn: api.createSecret,
    onSuccess: (secret) => {
      toast.success("Secret created", {
        description: `${secret.namespace}/${secret.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["secrets"] })
      setSecretSaved(true)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Secret already exists", {
          description:
            error.message !== ""
              ? error.message
              : "A secret with this name already exists in that namespace — delete it first or pick another name.",
        })
      } else {
        toast.error("Failed to create secret", {
          description: error instanceof Error ? error.message : "Unknown error",
        })
      }
    },
  })

  const parsedBudget = Number(maxBudget)
  const canGenerate =
    keyAlias.trim() !== "" && !generateMutation.isPending && generated === null

  function handleGenerate(event: FormEvent) {
    event.preventDefault()
    if (!canGenerate) return
    generateMutation.mutate({
      keyAlias: keyAlias.trim(),
      ...(duration !== NO_EXPIRY ? { duration } : {}),
      models: models
        .split(",")
        .map((model) => model.trim())
        .filter((model) => model !== ""),
      ...(maxBudget.trim() !== "" && !Number.isNaN(parsedBudget) && parsedBudget > 0
        ? { maxBudget: parsedBudget }
        : {}),
    })
  }

  const canSaveSecret =
    generated !== null &&
    secretNamespace.trim() !== "" &&
    secretName.trim() !== "" &&
    secretDataKey.trim() !== "" &&
    !secretSaved &&
    !saveSecretMutation.isPending

  function handleSaveSecret() {
    if (!canSaveSecret || generated === null) return
    saveSecretMutation.mutate({
      namespace: secretNamespace.trim(),
      name: secretName.trim(),
      data: { [secretDataKey.trim()]: generated.key },
    })
  }

  async function handleCopy() {
    if (generated === null) return
    try {
      await navigator.clipboard.writeText(generated.key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Copy failed", {
        description: "Clipboard is unavailable — select and copy manually.",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Key</DialogTitle>
          <DialogDescription>
            Mint a LiteLLM virtual API key for agent workloads.
          </DialogDescription>
        </DialogHeader>

        {generated === null ? (
          <form onSubmit={handleGenerate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gw-alias">Key alias</Label>
                <Input
                  id="gw-alias"
                  placeholder="agent-luna"
                  value={keyAlias}
                  onChange={(event) => setKeyAlias(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Duration</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {durationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gw-models">Models (optional)</Label>
              <Input
                id="gw-models"
                placeholder="claude-sonnet-4, claude-opus-4"
                value={models}
                onChange={(event) => setModels(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Empty allows all models.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gw-budget">Max budget in USD (optional)</Label>
              <Input
                id="gw-budget"
                inputMode="decimal"
                placeholder="10.00"
                value={maxBudget}
                onChange={(event) => setMaxBudget(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Empty or 0 means no budget cap.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canGenerate}>
                {generateMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Generate
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3 rounded-md border border-primary/30 bg-secondary p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
                <KeySquare className="size-4 text-primary" />
                Key generated — shown once
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {generated.key}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy key"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Shown once — store it now. The plaintext key cannot be
                retrieved again.
              </p>

              <Separator />

              <p className="text-sm font-medium text-secondary-foreground">
                Save as k8s Secret
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="gw-secret-ns" className="text-xs text-muted-foreground">
                    Namespace
                  </Label>
                  <Input
                    id="gw-secret-ns"
                    value={secretNamespace}
                    onChange={(event) => setSecretNamespace(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gw-secret-name" className="text-xs text-muted-foreground">
                    Secret name
                  </Label>
                  <Input
                    id="gw-secret-name"
                    value={secretName}
                    onChange={(event) => setSecretName(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gw-secret-key" className="text-xs text-muted-foreground">
                    Data key
                  </Label>
                  <Input
                    id="gw-secret-key"
                    value={secretDataKey}
                    onChange={(event) => setSecretDataKey(event.target.value)}
                  />
                </div>
              </div>
              {secretSaved ? (
                <p className="text-xs text-muted-foreground">
                  Saved. Workloads can now reference it via secretKeyRef (
                  {secretName.trim()}, key {secretDataKey.trim()}).
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canSaveSecret}
                  onClick={handleSaveSecret}
                >
                  {saveSecretMutation.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Save Secret
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
