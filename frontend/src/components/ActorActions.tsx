import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Loader2,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import type { Actor, ActorStatus } from "@/lib/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ActorAction = "resume" | "resume-boot" | "suspend" | "pause" | "delete"

const actionLabels: Record<ActorAction, string> = {
  resume: "Resume",
  "resume-boot": "Resume (cold boot)",
  suspend: "Suspend",
  pause: "Pause",
  delete: "Delete",
}

const resumableStatuses: ActorStatus[] = ["SUSPENDED", "PAUSED", "CRASHED"]

export function ActorActions({
  actor,
  variant = "menu",
  onDeleted,
}: {
  actor: Actor
  variant?: "menu" | "buttons"
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const mutation = useMutation<unknown, unknown, ActorAction>({
    mutationFn: (action: ActorAction) => {
      switch (action) {
        case "resume":
          return api.resumeActor(actor.atespace, actor.name, false)
        case "resume-boot":
          return api.resumeActor(actor.atespace, actor.name, true)
        case "suspend":
          return api.suspendActor(actor.atespace, actor.name)
        case "pause":
          return api.pauseActor(actor.atespace, actor.name)
        case "delete":
          return api.deleteActor(actor.atespace, actor.name)
      }
    },
    onSuccess: (_data, action) => {
      toast.success(`${actionLabels[action]} requested`, {
        description: `${actor.atespace}/${actor.name}`,
      })
      void queryClient.invalidateQueries({ queryKey: ["actors"] })
      void queryClient.invalidateQueries({
        queryKey: ["actor", actor.atespace, actor.name],
      })
      if (action === "delete") {
        setConfirmDelete(false)
        onDeleted?.()
      }
    },
    onError: (error, action) => {
      toast.error(`${actionLabels[action]} failed`, {
        description:
          error instanceof Error ? error.message : "Unknown error",
      })
    },
  })

  const canResume = resumableStatuses.includes(actor.status)
  const canSuspendOrPause = actor.status === "RUNNING"
  const pendingAction = mutation.isPending ? mutation.variables : null

  const deleteDialog = (
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete actor {actor.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the actor from atespace &quot;
            {actor.atespace}&quot;. Only suspended actors can be deleted — the
            server rejects the request otherwise.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("delete")}
          >
            {pendingAction === "delete" && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (variant === "buttons") {
    const items: {
      action: Exclude<ActorAction, "delete">
      icon: typeof Play
      enabled: boolean
    }[] = [
      { action: "resume", icon: Play, enabled: canResume },
      { action: "resume-boot", icon: Zap, enabled: canResume },
      { action: "suspend", icon: Moon, enabled: canSuspendOrPause },
      { action: "pause", icon: Pause, enabled: canSuspendOrPause },
    ]
    return (
      <div className="flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <Button
            key={item.action}
            variant="outline"
            size="sm"
            disabled={!item.enabled || mutation.isPending}
            onClick={() => mutation.mutate(item.action)}
          >
            {pendingAction === item.action ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <item.icon className="size-4" />
            )}
            {actionLabels[item.action]}
          </Button>
        ))}
        <Button
          variant="destructive"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
        {deleteDialog}
      </div>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Actor actions">
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!canResume || mutation.isPending}
            onSelect={() => mutation.mutate("resume")}
          >
            <Play />
            Resume
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canResume || mutation.isPending}
            onSelect={() => mutation.mutate("resume-boot")}
          >
            <Zap />
            Resume (cold boot)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canSuspendOrPause || mutation.isPending}
            onSelect={() => mutation.mutate("suspend")}
          >
            <Moon />
            Suspend
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canSuspendOrPause || mutation.isPending}
            onSelect={() => mutation.mutate("pause")}
          >
            <Pause />
            Pause
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={mutation.isPending}
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {deleteDialog}
    </>
  )
}
