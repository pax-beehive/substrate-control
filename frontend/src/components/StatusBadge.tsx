import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ActorStatus } from "@/lib/types"

const statusStyles: Partial<Record<ActorStatus, string>> = {
  RUNNING:
    "border-[#BFDCC7] bg-[#E6F2E8] text-[#2F7D4F] dark:border-[#2F7D4F]/40 dark:bg-[#2F7D4F]/15 dark:text-[#8FC7A6]",
  RESUMING:
    "border-[#E8D9AC] bg-[#F7EFD4] text-[#8A6D1A] dark:border-[#8A6D1A]/40 dark:bg-[#8A6D1A]/15 dark:text-[#D4B96A]",
  SUSPENDING:
    "border-[#E8D9AC] bg-[#F7EFD4] text-[#8A6D1A] dark:border-[#8A6D1A]/40 dark:bg-[#8A6D1A]/15 dark:text-[#D4B96A]",
  PAUSING:
    "border-[#E8D9AC] bg-[#F7EFD4] text-[#8A6D1A] dark:border-[#8A6D1A]/40 dark:bg-[#8A6D1A]/15 dark:text-[#D4B96A]",
  SUSPENDED:
    "border-[#DDD9CE] bg-[#EFEDE5] text-[#6B6960] dark:border-[#55524B]/60 dark:bg-[#55524B]/25 dark:text-[#A6A39B]",
  PAUSED:
    "border-[#C2CFE8] bg-[#E5EAF7] text-[#3E5FA8] dark:border-[#3E5FA8]/40 dark:bg-[#3E5FA8]/20 dark:text-[#93A9D6]",
  CRASHED:
    "border-[#EFC4BC] bg-[#F9E4E0] text-[#B23B2E] dark:border-[#B23B2E]/40 dark:bg-[#B23B2E]/15 dark:text-[#E08B7E]",
}

export function StatusBadge({ status }: { status: ActorStatus }) {
  const style = statusStyles[status]
  if (!style) {
    return <Badge variant="outline">{status}</Badge>
  }
  return (
    <Badge variant="outline" className={cn("font-medium", style)}>
      {status}
    </Badge>
  )
}
