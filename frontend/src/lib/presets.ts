// Harness presets for the CreateTemplateDialog form mode. A preset only
// pre-fills form state — the user can edit everything before submitting.
// Add new presets by appending to templatePresets.

export interface LabelRow {
  key: string
  value: string
}

export interface EnvRow {
  name: string
  mode: "literal" | "secret"
  value: string // literal mode
  secretName: string // secret mode
  secretKey: string // secret mode
}

export interface TemplatePreset {
  id: string
  label: string
  // Inline info box shown while the preset is selected.
  info?: string
  containerName?: string
  containerImage?: string
  containerImagePlaceholder?: string
  containerCommand?: string
  readyzPath?: string
  readyzPort?: string
  env?: EnvRow[]
  workerSelector?: LabelRow[]
}

// The cluster's CRD rejects unpinned images with 422, so the pause image
// prefill is digest-pinned.
export const PINNED_PAUSE_IMAGE =
  "registry.k8s.io/pause:3.10.2@sha256:f548e0e8e3dc1896ca956272154dde3314e8cc4fde0a57577ee9fa1c63f5baf4"

export const templatePresets: TemplatePreset[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    info: "Requires a LiteLLM virtual key saved as Secret litellm-key (key api-key) — create one on the Gateway page — and a WorkerPool labeled workload: claude-multiplex.",
    containerName: "claude",
    containerImage: "",
    containerImagePlaceholder:
      "your-agent-image@sha256:... (must be digest-pinned)",
    env: [
      {
        name: "ANTHROPIC_API_KEY",
        mode: "secret",
        value: "",
        secretName: "litellm-key",
        secretKey: "api-key",
      },
      {
        name: "ANTHROPIC_BASE_URL",
        mode: "literal",
        value: "http://litellm.litellm.svc:4000",
        secretName: "",
        secretKey: "",
      },
      { name: "ACTOR_NAME", mode: "literal", value: "claude-1", secretName: "", secretKey: "" },
      { name: "TASK", mode: "literal", value: "your task description here", secretName: "", secretKey: "" },
      { name: "INTERVAL_SECONDS", mode: "literal", value: "60", secretName: "", secretKey: "" },
    ],
    workerSelector: [{ key: "workload", value: "claude-multiplex" }],
  },
  {
    id: "codex",
    label: "Codex",
    info: "Requires a LiteLLM virtual key saved as Secret litellm-key (key api-key) — create one on the Gateway page — and a WorkerPool labeled workload: codex.",
    containerName: "codex",
    containerImage: "",
    containerImagePlaceholder:
      "your-codex-image@sha256:... (must be digest-pinned)",
    env: [
      {
        name: "OPENAI_API_KEY",
        mode: "secret",
        value: "",
        secretName: "litellm-key",
        secretKey: "api-key",
      },
      {
        name: "OPENAI_BASE_URL",
        mode: "literal",
        value: "http://litellm.litellm.svc:4000",
        secretName: "",
        secretKey: "",
      },
      { name: "ACTOR_NAME", mode: "literal", value: "codex-1", secretName: "", secretKey: "" },
      { name: "TASK", mode: "literal", value: "your task description here", secretName: "", secretKey: "" },
      { name: "INTERVAL_SECONDS", mode: "literal", value: "60", secretName: "", secretKey: "" },
    ],
    workerSelector: [{ key: "workload", value: "codex" }],
  },
]
