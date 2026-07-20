import { Route, Routes } from "react-router-dom"

import { AppLayout } from "@/components/AppLayout"
import { EmptyState } from "@/components/states"
import ActorsPage from "@/pages/ActorsPage"
import ActorDetailPage from "@/pages/ActorDetailPage"
import AtespacesPage from "@/pages/AtespacesPage"
import GatewayPage from "@/pages/GatewayPage"
import MonitoringPage from "@/pages/MonitoringPage"
import PoolsPage from "@/pages/PoolsPage"
import SecretsPage from "@/pages/SecretsPage"
import TemplatesPage from "@/pages/TemplatesPage"
import WorkersPage from "@/pages/WorkersPage"

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ActorsPage />} />
        <Route path="actors/:atespace/:name" element={<ActorDetailPage />} />
        <Route path="workers" element={<WorkersPage />} />
        <Route path="monitoring" element={<MonitoringPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="pools" element={<PoolsPage />} />
        <Route path="secrets" element={<SecretsPage />} />
        <Route path="gateway" element={<GatewayPage />} />
        <Route path="atespaces" element={<AtespacesPage />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="Page not found"
              description="This console page does not exist."
            />
          }
        />
      </Route>
    </Routes>
  )
}
