import { useEffect, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import type { RegisterModelRequest } from "@/lib/types"
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

const providerOptions = [
  { id: "anthropic", label: "Anthropic", prefix: "anthropic/" },
  { id: "openai", label: "OpenAI", prefix: "openai/" },
  { id: "gemini", label: "Gemini", prefix: "gemini/" },
  { id: "deepseek", label: "DeepSeek", prefix: "deepseek/" },
  { id: "compatible", label: "OpenAI-compatible", prefix: "" },
]

export function RegisterModelDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [modelName, setModelName] = useState("")
  const [provider, setProvider] = useState("anthropic")
  const [model, setModel] = useState("anthropic/")
  const [apiKey, setApiKey] = useState("")
  const [apiBase, setApiBase] = useState("")

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setModelName("")
      setProvider("anthropic")
      setModel("anthropic/")
      setApiKey("")
      setApiBase("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: (req: RegisterModelRequest) => api.registerGatewayModel(req),
    onSuccess: (registered) => {
      toast.success(
        `model ${registered.modelName} is callable through the gateway`,
      )
      void queryClient.invalidateQueries({ queryKey: ["gatewayModels"] })
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error("Failed to register model", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  // The provider helper only rewrites the prefix of the model field; the
  // field itself stays fully editable.
  function applyProvider(id: string) {
    setProvider(id)
    const option = providerOptions.find((p) => p.id === id)
    const prefix = option?.prefix ?? ""
    setModel((current) => {
      const slash = current.indexOf("/")
      const suffix = slash >= 0 ? current.slice(slash + 1) : current
      return prefix + suffix
    })
  }

  const canSubmit =
    modelName.trim() !== "" &&
    model.trim() !== "" &&
    apiKey !== "" &&
    (provider !== "compatible" || apiBase.trim() !== "") &&
    !mutation.isPending

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    mutation.mutate({
      modelName: modelName.trim(),
      model: model.trim(),
      apiKey,
      ...(apiBase.trim() !== "" ? { apiBase: apiBase.trim() } : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register Model</DialogTitle>
          <DialogDescription>
            Register an upstream provider model with the LiteLLM gateway.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gm-name">Model name</Label>
            <Input
              id="gm-name"
              placeholder="claude-sonnet"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              What workloads will request, e.g. claude-sonnet.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={applyProvider}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gm-model">Model</Label>
              <Input
                id="gm-model"
                className="font-mono text-xs"
                placeholder="anthropic/claude-sonnet-4-5"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gm-apikey">API key</Label>
            <Input
              id="gm-apikey"
              type="password"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted by the gateway, never shown again.
            </p>
          </div>

          {provider === "compatible" && (
            <div className="space-y-2">
              <Label htmlFor="gm-apibase">API base</Label>
              <Input
                id="gm-apibase"
                className="font-mono text-xs"
                placeholder="https://your-endpoint/v1"
                value={apiBase}
                onChange={(event) => setApiBase(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Required for OpenAI-compatible providers.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Register
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
