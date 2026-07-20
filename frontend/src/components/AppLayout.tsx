import { NavLink, Outlet } from "react-router-dom"
import {
  Activity,
  Bot,
  Boxes,
  KeyRound,
  LayoutTemplate,
  Network,
  Orbit,
  Server,
  Layers,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Separator } from "@/components/ui/separator"

const navItems = [
  { to: "/", label: "Actors", icon: Bot, end: true },
  { to: "/workers", label: "Workers", icon: Server, end: false },
  { to: "/monitoring", label: "Monitoring", icon: Activity, end: false },
  { to: "/templates", label: "Templates", icon: LayoutTemplate, end: false },
  { to: "/pools", label: "Worker Pools", icon: Layers, end: false },
  { to: "/secrets", label: "Secrets", icon: KeyRound, end: false },
  { to: "/gateway", label: "Gateway", icon: Network, end: false },
  { to: "/atespaces", label: "Atespaces", icon: Boxes, end: false },
]

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-4">
          <Orbit className="size-5 text-primary" />
          <span className="font-display font-semibold tracking-tight">
            Substrate Control
          </span>
        </div>
        <Separator />
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                  isActive && "bg-[#D97757]/12 text-[#D97757] hover:bg-[#D97757]/12 hover:text-[#D97757]",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Separator />
        <div className="flex items-center justify-between p-2">
          <span className="px-2 text-xs text-muted-foreground">
            Agent Substrate
          </span>
          <ThemeToggle />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
