import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import type { CreateActorRequest, K8sObject } from "@/lib/types"
import { WarningState } from "@/components/states"
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

const CUSTOM_ATESPACE = "__custom__"
const MANUAL_TEMPLATE = "__manual__"

interface LabelRow {
  key: string
  value: string
}

export function CreateActorDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [atespace, setAtespace] = useState("")
  const [customAtespace, setCustomAtespace] = useState("")
  const [name, setName] = useState("")
  const [template, setTemplate] = useState("")
  const [templateNamespace, setTemplateNamespace] = useState("")
  const [templateName, setTemplateName] = useState("")
  const [labels, setLabels] = useState<LabelRow[]>([])

  const atespacesQuery = useQuery({
    queryKey: ["atespaces"],
    queryFn: api.listAtespaces,
  })
  const templatesQuery = useQuery({
    queryKey: ["actortemplates"],
    queryFn: api.listActorTemplates,
    retry: false,
  })

  const atespaces = atespacesQuery.data?.atespaces ?? []
  const templateItems = templatesQuery.data?.items
  const templatesUnavailable = templatesQuery.isError

  const templateGroups = useMemo(() => {
    const groups = new Map<string, K8sObject[]>()
    for (const item of templateItems ?? []) {
      const list = groups.get(item.namespace) ?? []
      list.push(item)
      groups.set(item.namespace, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [templateItems])

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setAtespace("")
      setCustomAtespace("")
      setName("")
      setTemplate("")
      setTemplateNamespace("")
      setTemplateName("")
      setLabels([])
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: (req: CreateActorRequest) => api.createActor(req),
    onSuccess: (actor) => {
      toast.success("Actor created", {
        description: `${actor.atespace}/${actor.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["actors"] })
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error("Failed to create actor", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const manualTemplate = templatesUnavailable || template === MANUAL_TEMPLATE
  const resolvedAtespace =
    atespaces.length === 0 || atespace === CUSTOM_ATESPACE
      ? customAtespace.trim()
      : atespace
  const [selectedNs, selectedName] = template.split("/")
  const resolvedTemplateNamespace = manualTemplate
    ? templateNamespace.trim()
    : (selectedNs ?? "")
  const resolvedTemplateName = manualTemplate
    ? templateName.trim()
    : (selectedName ?? "")

  const canSubmit =
    resolvedAtespace !== "" &&
    name.trim() !== "" &&
    resolvedTemplateNamespace !== "" &&
    resolvedTemplateName !== "" &&
    !mutation.isPending

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const matchLabels = Object.fromEntries(
      labels
        .map((row) => [row.key.trim(), row.value.trim()])
        .filter(([key, value]) => key !== "" && value !== ""),
    )
    mutation.mutate({
      atespace: resolvedAtespace,
      name: name.trim(),
      actorTemplateNamespace: resolvedTemplateNamespace,
      actorTemplateName: resolvedTemplateName,
      ...(Object.keys(matchLabels).length > 0
        ? { workerSelector: { matchLabels } }
        : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Actor</DialogTitle>
          <DialogDescription>
            Instantiate a stateful actor from an ActorTemplate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="actor-atespace">Atespace</Label>
              {atespaces.length > 0 ? (
                <Select value={atespace} onValueChange={setAtespace}>
                  <SelectTrigger id="actor-atespace" className="w-full">
                    <SelectValue placeholder="Select atespace" />
                  </SelectTrigger>
                  <SelectContent>
                    {atespaces.map((space) => (
                      <SelectItem key={space.name} value={space.name}>
                        {space.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_ATESPACE}>
                      Enter manually…
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="actor-atespace"
                  placeholder="my-space"
                  value={customAtespace}
                  onChange={(event) => setCustomAtespace(event.target.value)}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="actor-name">Name</Label>
              <Input
                id="actor-name"
                placeholder="my-actor"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>
          {atespaces.length > 0 && atespace === CUSTOM_ATESPACE && (
            <div className="space-y-2">
              <Label htmlFor="actor-atespace-custom">Atespace name</Label>
              <Input
                id="actor-atespace-custom"
                placeholder="my-space"
                value={customAtespace}
                onChange={(event) => setCustomAtespace(event.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="actor-template">ActorTemplate</Label>
            {templatesUnavailable ? (
              <WarningState
                title="ActorTemplates unavailable"
                message="The backend may not have cluster access. Enter the template manually."
              />
            ) : (
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger id="actor-template" className="w-full">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templateGroups.map(([namespace, items]) => (
                    <SelectGroup key={namespace}>
                      <SelectLabel>{namespace}</SelectLabel>
                      {items.map((item) => (
                        <SelectItem
                          key={`${item.namespace}/${item.name}`}
                          value={`${item.namespace}/${item.name}`}
                        >
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                  <SelectItem value={MANUAL_TEMPLATE}>
                    Enter manually…
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          {manualTemplate && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="actor-template-ns">Template namespace</Label>
                <Input
                  id="actor-template-ns"
                  placeholder="ate-demo-counter"
                  value={templateNamespace}
                  onChange={(event) =>
                    setTemplateNamespace(event.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="actor-template-name">Template name</Label>
                <Input
                  id="actor-template-name"
                  placeholder="counter"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
              </div>
            </div>
          )}

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
