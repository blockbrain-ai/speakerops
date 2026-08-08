/**
 * Minimal speaker portal landing after magic-link exchange (section 2.1).
 * Full portal (bio, files, tasks) lands in 4.x — this proves B02 redirect target.
 */
export function PortalHomePage() {
  return (
    <div className="login-page" data-testid="portal-home" data-section="2.1">
      <div className="login-card">
        <p className="login-card__overline">Speaker portal</p>
        <h1 className="login-card__title">Welcome</h1>
        <p className="login-card__subtitle">
          You are signed in. Profile, files, and tasks land in later sections.
        </p>
      </div>
    </div>
  );
}
