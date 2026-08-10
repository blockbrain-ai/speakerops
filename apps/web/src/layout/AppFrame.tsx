/**
 * Full-viewport app frame for non-admin authenticated surfaces.
 * Do not reuse admin-shell__content padding (was BareLayout anti-pattern).
 */
import type { ReactNode } from "react";

export function AppFrame({
  children,
  testId = "app-frame",
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="app-frame" data-testid={testId}>
      {children}
    </div>
  );
}
