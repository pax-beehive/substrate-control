import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// Renders a label map as truncated key=value badges (first two + "+N" with
// a tooltip listing the rest).
export function LabelsCell({
  labels,
}: {
  labels?: Record<string, string> | null
}) {
  const entries = Object.entries(labels ?? {})
  if (entries.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  const shown = entries.slice(0, 2)
  const hidden = entries.slice(2)
  return (
    <div className="flex max-w-64 flex-wrap items-center gap-1">
      {shown.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="font-mono text-xs">
          {key}={value}
        </Badge>
      ))}
      {hidden.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="cursor-default text-xs">
              +{hidden.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1 font-mono text-xs">
              {hidden.map(([key, value]) => (
                <div key={key}>
                  {key}={value}
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
