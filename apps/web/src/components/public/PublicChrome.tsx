/**
 * Shared public chrome for `/` and `/developers`.
 *
 * Surface-aware testids so landing inventory (`landing-*`) survives extraction.
 * Learn is always the external host — never same-origin `/learn`.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLockup } from "../ui/BrandMark.js";
import { Icon } from "../ui/Icon.js";

/** External Learn host — never use same-origin /learn (Worker returns plain 404). */
export const LEARN_DOCS_URL = "https://learn.speakerops.org";
/** Machine-readable API surface served by this app. */
export const OPENAPI_URL = "/openapi.json";
/** Canonical public source. */
export const GITHUB_REPO_URL = "https://github.com/blockbrain-ai/speakerops";
/** Competition source mirror — GitHub remains primary. Live site is not on Forge. */
export const SMOLFORGE_REPO_URL =
  "https://forge.smol.ai/blockbrain_labs/speakerops";
export const LEARN_CLI_URL = `${LEARN_DOCS_URL}/agents/cli-and-keys`;

export type PublicChromeSurface = "landing" | "developers";

function tid(surface: PublicChromeSurface, name: string): string {
  return surface === "landing" ? `landing-${name}` : `developers-${name}`;
}

export function PublicChrome({
  surface,
  children,
}: {
  surface: PublicChromeSurface;
  children: ReactNode;
}) {
  const onDevelopers = surface === "developers";
  const rootTestId = onDevelopers ? "page-developers" : "page-landing";
  const rootClass = onDevelopers
    ? "public-landing public-dev"
    : "public-landing";

  return (
    <div className={rootClass} data-testid={rootTestId}>
      <header className="public-landing__bar" data-testid={tid(surface, "topbar")}>
        <Link
          to="/"
          className="public-landing__brand lumen-focusable"
          aria-label="SpeakerOps home"
          data-testid={onDevelopers ? "developers-brand" : "landing-brand"}
        >
          <BrandLockup size={26} />
        </Link>
        <nav className="public-landing__nav" aria-label="Product">
          <Link
            className={`public-landing__nav-link lumen-focusable${onDevelopers ? " is-current" : ""}`}
            to="/developers"
            aria-current={onDevelopers ? "page" : undefined}
            data-testid={tid(surface, "nav-developers")}
          >
            Developers
          </Link>
          <a
            className="public-landing__nav-link lumen-focusable"
            href={LEARN_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={tid(surface, "nav-docs")}
          >
            Docs
          </a>
          <div className="public-landing__nav-marks" role="group" aria-label="Source">
            <a
              className="public-landing__nav-icon lumen-focusable"
              href={GITHUB_REPO_URL}
              rel="noopener noreferrer"
              target="_blank"
              aria-label="GitHub"
              data-testid={tid(surface, "nav-github")}
            >
              <Icon name="github" size="md" decorative />
            </a>
            <a
              className="public-landing__nav-icon lumen-focusable"
              href={SMOLFORGE_REPO_URL}
              rel="noopener noreferrer"
              target="_blank"
              aria-label="SmolForge"
              data-testid={tid(surface, "nav-forge")}
            >
              <Icon name="forge" size="md" decorative />
            </a>
          </div>
          <Link
            className="public-landing__btn public-landing__btn--ghost lumen-focusable"
            to="/login"
            data-testid={tid(surface, "sign-in")}
          >
            Sign in
          </Link>
          <Link
            className="public-landing__btn public-landing__btn--primary lumen-focusable"
            to="/judge"
            data-testid={tid(surface, "judge-access")}
          >
            Judge access
          </Link>
        </nav>
      </header>

      {children}

      <footer className="public-landing__foot" data-testid={tid(surface, "footer")}>
        <span className="public-landing__fine">
          Open source · MIT · Cloudflare-native (Workers + D1)
        </span>
        <a
          href={LEARN_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={tid(surface, "footer-docs")}
        >
          Documentation
        </a>
        <Link to="/developers" data-testid={tid(surface, "footer-developers")}>
          Developers
        </Link>
        <a
          href={OPENAPI_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={tid(surface, "footer-api")}
        >
          API
        </a>
        <a
          href={GITHUB_REPO_URL}
          rel="noopener noreferrer"
          target="_blank"
          data-testid={tid(surface, "footer-github")}
        >
          GitHub
        </a>
        <a
          href={SMOLFORGE_REPO_URL}
          rel="noopener noreferrer"
          target="_blank"
          data-testid={tid(surface, "footer-forge")}
        >
          SmolForge
        </a>
      </footer>
    </div>
  );
}
