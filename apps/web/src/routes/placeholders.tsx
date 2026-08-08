/**
 * Route page stubs for admin chrome (section 1.4).
 *
 * Structural shells only — no fake domain data, no pretend mutations.
 * Later sections replace these with real surfaces wired to COMMANDS.md APIs.
 */
import type { ReactNode } from "react";

export type PageStubProps = {
  overline?: string;
  title: string;
  body: string;
  testId: string;
};

export function PageStub({ overline, title, body, testId }: PageStubProps) {
  return (
    <section className="page-stub" data-testid={testId}>
      {overline ? <p className="page-stub__overline">{overline}</p> : null}
      <h2 className="page-stub__title">{title}</h2>
      <p className="page-stub__body">{body}</p>
    </section>
  );
}

export function OverviewPage() {
  return (
    <PageStub
      overline="Admin"
      title="Overview"
      body="Readiness and programme overview will land in the dashboard section. Shell only."
      testId="page-overview"
    />
  );
}

/** @deprecated Replaced by FormBuilderPage (section 3.2). Kept for type exports only. */
export function CfpFormsPage() {
  return (
    <PageStub
      overline="CFP / Forms"
      title="Forms"
      body="Form builder UI is FormBuilderPage at /admin/cfp (section 3.2)."
      testId="page-cfp-placeholder"
    />
  );
}

/** @deprecated Replaced by SubmissionsPage (section 3.5). */
export function SubmissionsPage() {
  return (
    <PageStub
      overline="Submissions"
      title="Submissions"
      body="Submission list and decisions are SubmissionsPage at /admin/submissions (section 3.5)."
      testId="page-submissions-placeholder"
    />
  );
}

/** @deprecated Replaced by AdminEvaluationsPage (section 3.4). */
export function EvaluationsPage() {
  return (
    <PageStub
      overline="Evaluations"
      title="Evaluations"
      body="Admin evaluation rollup is AdminEvaluationsPage at /admin/evaluations (section 3.4)."
      testId="page-evaluations-placeholder"
    />
  );
}

/** @deprecated Replaced by SpeakersPage (section 4.1 API UI). */
export function SpeakersPage() {
  return (
    <PageStub
      overline="Speakers"
      title="Speakers"
      body="Admin speaker list is SpeakersPage at /admin/speakers (section 4.1)."
      testId="page-speakers-placeholder"
    />
  );
}

export function SchedulePage() {
  return (
    <PageStub
      overline="Schedule"
      title="Schedule"
      body="Schedule Studio hero surface lands in section 6.2."
      testId="page-schedule"
    />
  );
}

/** @deprecated Prefer apps/web/src/pages/Comms.tsx (section 5.1). */
export function CommsPage() {
  return (
    <PageStub
      overline="Comms"
      title="Comms"
      body="Comms compose and send with trust-before-automation land in phase 5."
      testId="page-comms-stub"
    />
  );
}

export function SettingsPage() {
  return (
    <PageStub
      overline="Settings"
      title="Settings"
      body="Event · Rooms/Tracks · Tasks · Design · API Keys · Airtable status land in settings sections."
      testId="page-settings"
    />
  );
}

/** Public CFP route stub — brand retheme surface (later); light Lumen default now. */
export function PublicCfpStubPage() {
  return (
    <PageStub
      overline="Public"
      title="CFP"
      body="Public CFP form lands in section 3.3. Brand tokens apply here after Design Kit publish."
      testId="page-public-cfp"
    />
  );
}

export function NotFoundPage() {
  return (
    <PageStub
      overline="Error"
      title="Not found"
      body="No route matches this path."
      testId="page-not-found"
    />
  );
}

/** Wrap children for non-admin surfaces (public) without inventing extra chrome. */
export function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell__content" data-testid="bare-layout">
      {children}
    </div>
  );
}
