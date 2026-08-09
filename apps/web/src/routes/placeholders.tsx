/**
 * Shared non-product route helpers (section 1.4 shell primitives).
 *
 * Product surfaces live under apps/web/src/pages/* and are wired in App.tsx.
 * This module only keeps BareLayout + NotFound — no domain page stubs.
 */
import type { ReactNode } from "react";

export type PageStubProps = {
  overline?: string;
  title: string;
  body: string;
  testId: string;
};

/** Generic empty/error surface (used by NotFound only). */
export function PageStub({ overline, title, body, testId }: PageStubProps) {
  return (
    <section className="page-stub" data-testid={testId}>
      {overline ? <p className="page-stub__overline">{overline}</p> : null}
      <h2 className="page-stub__title">{title}</h2>
      <p className="page-stub__body">{body}</p>
    </section>
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
