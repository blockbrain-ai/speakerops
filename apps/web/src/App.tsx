/**
 * App router + shared admin layout (section 1.4) + auth login (section 2.1)
 * + RequireRole admin guards (section 2.2) + event context (section 2.3)
 * + Design Kit (section 2.4) + Form builder (section 3.2)
 * + Public CFP submit (section 3.3) + Eval queue / rubric (section 3.4)
 * + Submissions decisions (section 3.5)
 * + Portal APIs / task templates / admin speakers (section 4.1)
 * + Speaker portal UI G01–G08 (section 4.3)
 * + Comms email templates (section 5.1) + trust-before-send UI (section 5.3)
 * + Schedule Studio five views I01–I16 (section 6.2).
 * + Readiness dashboard H01–H05 + speakers L05 (section 6.3 / S-READY).
 * + API keys mint/revoke K01–K04 (section 7.1 / S-CLI).
 * + Airtable projection status O06 (section 7.3 / S-AIRTABLE).
 * + Dogfood role switcher (section 8.4 — dev / VITE_ROLE_SWITCHER only).
 * + Lumen 2 state sheet (section 11.0 — S-L2-SYSTEM / @inv:L2-01).
 * Composition root mounts this from main.tsx.
 */
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { AdminShell } from "./layout/AdminShell.js";
import { SettingsShell } from "./layout/SettingsShell.js";
import { RoleShell } from "./layout/RoleShell.js";
import { RequireRole } from "./auth/RequireRole.js";
import { EventProvider } from "./events/EventContext.js";
import { LoginPage } from "./pages/Login.js";
import JudgeAccessPage from "./pages/JudgeAccess.js";
import { PortalHomePage } from "./pages/PortalHome.js";
import { EventSettingsPage } from "./pages/EventSettings.js";
import { DesignKitPage } from "./pages/DesignKit.js";
import { PublicCfpPage } from "./pages/PublicCfp.js";
import { PublicProgrammePage } from "./pages/public/PublicProgramme.js";
import { HistoryPage } from "./pages/operator/HistoryPage.js";
import { TeamPage } from "./pages/operator/TeamPage.js";
import { FilesPage } from "./pages/operator/FilesPage.js";
import { EmbedConfiguratorPage } from "./pages/operator/EmbedConfigurator.js";
import { PreviewHubPage } from "./pages/operator/PreviewHub.js";
import { AnalyticsDashboardPage } from "./pages/operator/AnalyticsDashboard.js";
import { PortalFormsPage } from "./pages/operator/PortalFormsPage.js";
import { ResourcesPage } from "./pages/operator/ResourcesPage.js";
import { FileRequestsPage } from "./pages/operator/FileRequestsPage.js";
import { FormBuilderPage } from "./pages/FormBuilder.js";
import { EvaluatorQueuePage } from "./pages/EvaluatorQueue.js";
import { RubricSettingsPage } from "./pages/RubricSettings.js";
import { AdminEvaluationsPage } from "./pages/AdminEvaluations.js";
import { SubmissionsPage } from "./pages/Submissions.js";
import { TaskTemplatesSettingsPage } from "./pages/TaskTemplatesSettings.js";
import { SpeakersPage } from "./pages/Speakers.js";
import { CommsPage } from "./pages/Comms.js";
import { ScheduleStudioPage } from "./pages/schedule/ScheduleStudio.js";
import { ReadinessPage } from "./pages/Readiness.js";
import { ApiKeysPage } from "./pages/ApiKeys.js";
import { IntegrationsPage } from "./pages/operator/IntegrationsPage.js";
import { L2StateSheetPage } from "./pages/L2StateSheet.js";
import {
  BareLayout,
  NotFoundPage,
} from "./routes/placeholders.js";
import { PublicLandingPage } from "./pages/PublicLanding.js";
import type { ReactNode } from "react";

/**
 * Admin layout route (fix wave A1): RequireRole + EventProvider + AdminShell
 * mount ONCE for the whole /admin tree; child pages render through <Outlet/>.
 * The guard therefore probes once per surface entry — in-app navigation never
 * unmounts the chrome or shows "Checking access…" (B04/B05 fail-closed
 * behaviour is unchanged: visibility re-probes still unmount on 401/403).
 */
function AdminLayout() {
  return (
    <RequireRole roles={["admin"]}>
      <EventProvider>
        <AdminShell>
          <Outlet />
        </AdminShell>
      </EventProvider>
    </RequireRole>
  );
}

/**
 * Settings two-pane shell (section 11.7 · S-L2-A11Y) — nested layout route
 * under the admin layout, so settings sub-navigation swaps only the detail
 * pane (chrome + event context + category nav all stay mounted).
 */
function SettingsLayout() {
  return (
    <SettingsShell>
      <Outlet />
    </SettingsShell>
  );
}

/** Evaluator surface — protected queue with account shell (no fake Queue self-link). */
function EvaluatorGuard({ children }: { children: ReactNode }) {
  return (
    <RequireRole roles={["evaluator"]}>
      <BareLayout>
        <RoleShell role="evaluator">{children}</RoleShell>
      </BareLayout>
    </RequireRole>
  );
}

/**
 * Speaker portal — RoleShell chrome only; section nav owned by PortalHome
 * (passes active section + handlers into RoleShell via context would couple
 * tightly). PortalHome renders RoleShell itself for eventName/brand props.
 */
function SpeakerGuard({ children }: { children: ReactNode }) {
  return (
    <RequireRole roles={["speaker"]}>
      <BareLayout>{children}</BareLayout>
    </RequireRole>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Wave-1 public front door (owner-approved mock) — not a redirect to /admin. */}
      <Route
        path="/"
        element={
          <BareLayout>
            <PublicLandingPage />
          </BareLayout>
        }
      />
      <Route
        path="/login"
        element={
          <BareLayout>
            <LoginPage />
          </BareLayout>
        }
      />
      <Route
        path="/judge"
        element={
          <BareLayout>
            <JudgeAccessPage />
          </BareLayout>
        }
      />
      <Route
        path="/portal"
        element={
          <SpeakerGuard>
            <PortalHomePage />
          </SpeakerGuard>
        }
      />
      <Route
        path="/eval"
        element={
          <EvaluatorGuard>
            <EvaluatorQueuePage />
          </EvaluatorGuard>
        }
      />
      {/* Admin surface — ONE guard + chrome mount for the whole tree (A1).
          Child paths are absolute (React Router allows this when they match
          the parent prefix) so route strings stay grep-able as full URLs. */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<ReadinessPage />} />
        <Route path="/admin/cfp" element={<FormBuilderPage />} />
        <Route path="/admin/submissions" element={<SubmissionsPage />} />
        <Route path="/admin/evaluations" element={<AdminEvaluationsPage />} />
        <Route path="/admin/speakers" element={<SpeakersPage />} />
        <Route path="/admin/schedule" element={<ScheduleStudioPage />} />
        <Route path="/admin/comms" element={<CommsPage />} />
        <Route path="/admin/files" element={<FilesPage />} />
        <Route path="/admin/history" element={<HistoryPage />} />
        <Route path="/admin/team" element={<TeamPage />} />
        <Route path="/admin/embeds" element={<EmbedConfiguratorPage />} />
        <Route path="/admin/preview" element={<PreviewHubPage />} />
        <Route path="/admin/analytics" element={<AnalyticsDashboardPage />} />
        <Route path="/admin/portal-forms" element={<PortalFormsPage />} />
        <Route path="/admin/resources" element={<ResourcesPage />} />
        <Route path="/admin/file-requests" element={<FileRequestsPage />} />
        <Route path="/admin/settings" element={<SettingsLayout />}>
          <Route index element={<EventSettingsPage />} />
          <Route path="/admin/settings/design" element={<DesignKitPage />} />
          <Route path="/admin/settings/rubric" element={<RubricSettingsPage />} />
          <Route
            path="/admin/settings/task-templates"
            element={<TaskTemplatesSettingsPage />}
          />
          <Route path="/admin/settings/api-keys" element={<ApiKeysPage />} />
          <Route
            path="/admin/settings/integrations"
            element={<IntegrationsPage />}
          />
          <Route
            path="/admin/settings/airtable"
            element={<IntegrationsPage />}
          />
          <Route
            path="/admin/settings/l2-state-sheet"
            element={<L2StateSheetPage />}
          />
        </Route>
      </Route>
      <Route
        path="/cfp/:slug"
        element={
          <BareLayout>
            <PublicCfpPage />
          </BareLayout>
        }
      />
      {/* P11 public programme pages (F7 publish gate) */}
      <Route
        path="/e/:slug"
        element={
          <BareLayout>
            <PublicProgrammePage view="hub" />
          </BareLayout>
        }
      />
      <Route
        path="/e/:slug/sessions"
        element={
          <BareLayout>
            <PublicProgrammePage view="sessions" />
          </BareLayout>
        }
      />
      <Route
        path="/e/:slug/speakers"
        element={
          <BareLayout>
            <PublicProgrammePage view="speakers" />
          </BareLayout>
        }
      />
      <Route
        path="/e/:slug/agenda"
        element={
          <BareLayout>
            <PublicProgrammePage view="agenda" />
          </BareLayout>
        }
      />
      <Route
        path="/e/:slug/itinerary"
        element={
          <BareLayout>
            <PublicProgrammePage view="itinerary" />
          </BareLayout>
        }
      />
      <Route
        path="/e/:slug/gallery"
        element={
          <BareLayout>
            <PublicProgrammePage view="gallery" />
          </BareLayout>
        }
      />
      {/* N4 public embeds — same programme read model, chrome-less host */}
      <Route
        path="/embed/:slug"
        element={
          <BareLayout>
            <PublicProgrammePage view="hub" embed />
          </BareLayout>
        }
      />
      <Route
        path="/embed/:slug/sessions"
        element={
          <BareLayout>
            <PublicProgrammePage view="sessions" embed />
          </BareLayout>
        }
      />
      <Route
        path="/embed/:slug/speakers"
        element={
          <BareLayout>
            <PublicProgrammePage view="speakers" embed />
          </BareLayout>
        }
      />
      <Route
        path="/embed/:slug/agenda"
        element={
          <BareLayout>
            <PublicProgrammePage view="agenda" embed />
          </BareLayout>
        }
      />
      <Route
        path="/embed/:slug/itinerary"
        element={
          <BareLayout>
            <PublicProgrammePage view="itinerary" embed />
          </BareLayout>
        }
      />
      <Route
        path="/embed/:slug/gallery"
        element={
          <BareLayout>
            <PublicProgrammePage view="gallery" embed />
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
      <div id="speakerops-root" data-section="4.3" data-testid="app-root">
        {/* Section 8.4 role switcher now lives INSIDE the single top bar
            (AdminShell header / RoleShell account) — F1 collapsed chrome. */}
        <AppRoutes />
      </div>
    </BrowserRouter>
  );
}
