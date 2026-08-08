/**
 * App router + shared admin layout (section 1.4) + auth login (section 2.1).
 * Composition root mounts this from main.tsx.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminShell } from "./layout/AdminShell.js";
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
          <AdminShell>
            <OverviewPage />
          </AdminShell>
        }
      />
      <Route
        path="/admin/cfp"
        element={
          <AdminShell>
            <CfpFormsPage />
          </AdminShell>
        }
      />
      <Route
        path="/admin/submissions"
        element={
          <AdminShell>
            <SubmissionsPage />
          </AdminShell>
        }
      />
      <Route
        path="/admin/evaluations"
        element={
          <AdminShell>
            <EvaluationsPage />
          </AdminShell>
        }
      />
      <Route
        path="/admin/speakers"
        element={
          <AdminShell>
            <SpeakersPage />
          </AdminShell>
        }
      />
      <Route
        path="/admin/schedule"
        element={
          <AdminShell>
            <SchedulePage />
          </AdminShell>
        }
      />
      <Route
        path="/admin/comms"
        element={
          <AdminShell>
            <CommsPage />
          </AdminShell>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <AdminShell>
            <SettingsPage />
          </AdminShell>
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
      <div id="speakerops-root" data-section="2.1" data-testid="app-root">
        <AppRoutes />
      </div>
    </BrowserRouter>
  );
}
