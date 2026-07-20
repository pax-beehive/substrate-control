// Kubernetes-style relative age: 45s, 12m, 3h, 4d.
export function formatAge(timestamp?: string): string {
  if (!timestamp) return "—"
  const time = Date.parse(timestamp)
  if (Number.isNaN(time)) return "—"
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

// Time remaining until a future timestamp: 45m, 12h, 7d, or "expired".
export function formatCountdown(timestamp?: string): string {
  if (!timestamp) return "—"
  const time = Date.parse(timestamp)
  if (Number.isNaN(time)) return "—"
  const seconds = Math.floor((time - Date.now()) / 1000)
  if (seconds <= 0) return "expired"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function formatDateTime(timestamp?: string): string {
  if (!timestamp) return "—"
  const time = Date.parse(timestamp)
  if (Number.isNaN(time)) return timestamp
  return new Date(time).toLocaleString()
}

export function truncateMiddle(value: string, max = 14): string {
  if (value.length <= max) return value
  const half = Math.floor((max - 1) / 2)
  return `${value.slice(0, half)}…${value.slice(-half)}`
}
