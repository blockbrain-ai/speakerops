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
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AdminShell } from "./layout/AdminShell.js";
import { SettingsShell } from "./layout/SettingsShell.js";
import { RoleShell } from "./layout/RoleShell.js";
import { RequireRole } from "./auth/RequireRole.js";
import { EventProvider } from "./events/EventContext.js";
import { RoleSwitcher, isRoleSwitcherEnabled } from "./components/RoleSwitcher.js";
import { LoginPage } from "./pages/Login.js";
import JudgeAccessPage from "./pages/JudgeAccess.js";
import { PortalHomePage } from "./pages/PortalHome.js";
import { EventSettingsPage } from "./pages/EventSettings.js";
import { DesignKitPage } from "./pages/DesignKit.js";
import { PublicCfpPage } from "./pages/PublicCfp.js";
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
import { AirtableStatusPage } from "./pages/AirtableStatus.js";
import { L2StateSheetPage } from "./pages/L2StateSheet.js";
import {
  BareLayout,
  NotFoundPage,
} from "./routes/placeholders.js";
import type { ReactNode } from "react";

/**
 * Dogfood/dev role switcher — only on authenticated product surfaces.
 * Never mount on public CFP / login: the fixed panel covers mobile submit (A09)
 * and other primary controls. Placement CSS keeps it off schedule unschedule.
 */
function RoleSwitcherMount() {
  const { pathname } = useLocation();
  if (!isRoleSwitcherEnabled()) return null;
  const onDogfoodSurface =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/portal") ||
    pathname.startsWith("/eval");
  if (!onDogfoodSurface) return null;
  return <RoleSwitcher />;
}

/** Wrap admin chrome with server-backed admin role guard (B04/B05) + event context. */
function AdminGuard({ children }: { children: ReactNode }) {
  return (
    <RequireRole roles={["admin"]}>
      <EventProvider>
        <AdminShell>{children}</AdminShell>
      </EventProvider>
    </RequireRole>
  );
}

/**
 * Settings two-pane shell (section 11.7 · S-L2-A11Y).
 * Nested under AdminGuard so chrome + event context remain shared.
 */
function SettingsGuard({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <SettingsShell>{children}</SettingsShell>
    </AdminGuard>
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
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <ReadinessPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/cfp"
        element={
          <AdminGuard>
            <FormBuilderPage />
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
            <AdminEvaluationsPage />
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
            <ScheduleStudioPage />
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
          <SettingsGuard>
            <EventSettingsPage />
          </SettingsGuard>
        }
      />
      <Route
        path="/admin/settings/design"
        element={
          <SettingsGuard>
            <DesignKitPage />
          </SettingsGuard>
        }
      />
      <Route
        path="/admin/settings/rubric"
        element={
          <SettingsGuard>
            <RubricSettingsPage />
          </SettingsGuard>
        }
      />
      <Route
        path="/admin/settings/task-templates"
        element={
          <SettingsGuard>
            <TaskTemplatesSettingsPage />
          </SettingsGuard>
        }
      />
      <Route
        path="/admin/settings/api-keys"
        element={
          <SettingsGuard>
            <ApiKeysPage />
          </SettingsGuard>
        }
      />
      <Route
        path="/admin/settings/airtable"
        element={
          <SettingsGuard>
            <AirtableStatusPage />
          </SettingsGuard>
        }
      />
      <Route
        path="/admin/settings/l2-state-sheet"
        element={
          <SettingsGuard>
            <L2StateSheetPage />
          </SettingsGuard>
        }
      />
      <Route
        path="/cfp/:slug"
        element={
          <BareLayout>
            <PublicCfpPage />
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
        {/* Section 8.4 — dogfood surfaces only (not public CFP / login). */}
        <RoleSwitcherMount />
        <AppRoutes />
      </div>
    </BrowserRouter>
  );
}
