import { parse as parseYaml } from "yaml"

import type { K8sObject } from "./types"

export interface ParsedManifest {
  namespace?: string
  name?: string
  labels?: Record<string, string>
  spec: Record<string, unknown>
}

// Parses a pasted YAML document into a CRD spec. Accepts either a full
// manifest (apiVersion/kind/metadata/spec) or a bare spec mapping.
export function specFromYaml(input: string): ParsedManifest {
  const doc: unknown = parseYaml(input)
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("YAML document must be a mapping")
  }
  const obj = doc as Record<string, unknown>
  if ("spec" in obj || "metadata" in obj) {
    if (obj.spec === null || typeof obj.spec !== "object") {
      throw new Error("Manifest has no spec field")
    }
    const metadata = obj.metadata as
      | { namespace?: unknown; name?: unknown; labels?: unknown }
      | undefined
    const rawLabels = metadata?.labels
    const labelEntries =
      rawLabels !== null && typeof rawLabels === "object" && !Array.isArray(rawLabels)
        ? Object.entries(rawLabels).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          )
        : []
    return {
      namespace:
        typeof metadata?.namespace === "string" ? metadata.namespace : undefined,
      name: typeof metadata?.name === "string" ? metadata.name : undefined,
      labels:
        labelEntries.length > 0 ? Object.fromEntries(labelEntries) : undefined,
      spec: obj.spec as Record<string, unknown>,
    }
  }
  return { namespace: undefined, name: undefined, spec: obj }
}

// Container images of an ActorTemplate, when it embeds a pod template at
// spec.template.spec.containers (the spec shape is dynamic, so this is a
// best-effort extraction).
export function containerImages(object: K8sObject): string[] {
  const spec = object.spec as
    | {
        template?: {
          spec?: { containers?: unknown; initContainers?: unknown }
        }
      }
    | undefined
  const podSpec = spec?.template?.spec
  const imagesOf = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return value
      .map((container) =>
        container !== null &&
        typeof container === "object" &&
        "image" in container &&
        typeof (container as { image: unknown }).image === "string"
          ? (container as { image: string }).image
          : null,
      )
      .filter((image): image is string => image !== null)
  }
  return [...imagesOf(podSpec?.containers), ...imagesOf(podSpec?.initContainers)]
}

// spec.replicas of a WorkerPool, when present.
export function replicaCount(object: K8sObject): number | null {
  const replicas = object.spec?.replicas
  return typeof replicas === "number" ? replicas : null
}
