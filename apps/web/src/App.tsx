/**
 * App router + shared admin layout (section 1.4) + auth login (section 2.1)
 * + RequireRole admin guards (section 2.2).
 * Composition root mounts this from main.tsx.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminShell } from "./layout/AdminShell.js";
import { RequireRole } from "./auth/RequireRole.js";
import { LoginPage } from "./pages/Login.js";
import { PortalHomePage } from "./pages/PortalHome.js";
import {
  BareLayout,
  CfpFormsPage,
  CommsPage,
  EvaluationsPage,
  NotFoundPage,
  OverviewPage,
  PublicCfpStubPage,
  SchedulePage,
  SettingsPage,
  SpeakersPage,
  SubmissionsPage,
} from "./routes/placeholders.js";
import type { ReactNode } from "react";

/** Wrap admin chrome with server-backed admin role guard (B04/B05). */
function AdminGuard({ children }: { children: ReactNode }) {
  return (
    <RequireRole roles={["admin"]}>
      <AdminShell>{children}</AdminShell>
    </RequireRole>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route
        path="/login"
        element={
          <BareLayout>
            <LoginPage />
          </BareLayout>
        }
      />
      <Route
        path="/portal"
        element={
          <BareLayout>
            <PortalHomePage />
          </BareLayout>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <OverviewPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/cfp"
        element={
          <AdminGuard>
            <CfpFormsPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/submissions"
        element={
          <AdminGuard>
            <SubmissionsPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/evaluations"
        element={
          <AdminGuard>
            <EvaluationsPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/speakers"
        element={
          <AdminGuard>
            <SpeakersPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/schedule"
        element={
          <AdminGuard>
            <SchedulePage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/comms"
        element={
          <AdminGuard>
            <CommsPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <AdminGuard>
            <SettingsPage />
          </AdminGuard>
        }
      />
      <Route
        path="/cfp/:slug"
        element={
          <BareLayout>
            <PublicCfpStubPage />
          </BareLayout>
        }
      />
      <Route
        path="*"
        element={
          <BareLayout>
            <NotFoundPage />
          </BareLayout>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div id="speakerops-root" data-section="2.2" data-testid="app-root">
        <AppRoutes />
      </div>
    </BrowserRouter>
  );
}
