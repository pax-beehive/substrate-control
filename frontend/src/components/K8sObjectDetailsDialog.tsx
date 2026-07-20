import { formatDateTime } from "@/lib/format"
import type { K8sObject } from "@/lib/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Renders the raw spec/status of a Kubernetes CRD object as pretty JSON.
export function K8sObjectDetailsDialog({
  object,
  kind,
  onOpenChange,
}: {
  object: K8sObject | null
  kind: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={object !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {object ? `${object.namespace}/${object.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            {kind}
            {object
              ? ` · created ${formatDateTime(object.creationTimestamp)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {object && (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-sm font-medium">Spec</h3>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(object.spec ?? {}, null, 2)}
              </pre>
            </section>
            {object.status && (
              <section>
                <h3 className="mb-2 text-sm font-medium">Status</h3>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(object.status, null, 2)}
                </pre>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
