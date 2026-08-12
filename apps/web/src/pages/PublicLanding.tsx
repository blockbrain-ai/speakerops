/**
 * Public product landing (/) — wave-1 front door (owner-approved mock).
 *
 * Replaces the anonymous redirect to /admin (which surfaced as session-expired).
 * Routes each audience: judge → /judge, organiser → /login,
 * docs → https://learn.speakerops.org (external Learn host, not /learn on this Worker).
 * Sage & Honey · BrandLockup · Lumen control tokens.
 */
import { Link } from "react-router-dom";
import { BrandLockup } from "../components/ui/BrandMark.js";

/** External Learn host — never use same-origin /learn (Worker returns plain 404). */
const LEARN_DOCS_URL = "https://learn.speakerops.org";
/** Machine-readable API surface served by this app. */
const OPENAPI_URL = "/openapi.json";

const LIFECYCLE = [
  { label: "Call for speakers", tone: "sage" as const },
  { label: "Review & score", tone: "info" as const },
  { label: "Decide & notify", tone: "deep" as const },
  { label: "Onboard speakers", tone: "honey" as const },
  { label: "Schedule", tone: "clay" as const },
  { label: "Publish", tone: "ink" as const },
];

const PILLARS = [
  {
    title: "For organisers",
    body: "Build conditional CFP forms, triage submissions in queues, score with rubrics, and track every speaker's readiness — with a schedule that blocks double-bookings for you.",
    tone: "leaf" as const,
    icon: "◈",
  },
  {
    title: "For speakers",
    body: "A warm self-service portal: one clear next task, rich bios, headshots and slides, calendar invites that update themselves when the schedule moves.",
    tone: "honey" as const,
    icon: "✉",
  },
  {
    title: "For your audience",
    body: "Publish Sessions, Speakers, Agenda, Itinerary and a Speaker Gallery as beautiful pages — or embed them straight into your own website.",
    tone: "clay" as const,
    icon: "◎",
  },
];

export function PublicLandingPage() {
  return (
    <div className="public-landing" data-testid="page-landing">
      <header className="public-landing__bar" data-testid="landing-topbar">
        <BrandLockup size={26} />
        <nav className="public-landing__nav" aria-label="Product">
          <a
            className="public-landing__nav-link lumen-focusable"
            href={LEARN_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-nav-docs"
          >
            Docs
          </a>
          <a
            className="public-landing__nav-link lumen-focusable"
            href="https://github.com/blockbrain-ai/speakerops"
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub
          </a>
          <Link
            className="public-landing__btn public-landing__btn--ghost lumen-focusable"
            to="/login"
            data-testid="landing-sign-in"
          >
            Sign in
          </Link>
          <Link
            className="public-landing__btn public-landing__btn--primary lumen-focusable"
            to="/judge"
            data-testid="landing-judge-access"
          >
            Judge access
          </Link>
        </nav>
      </header>

      <section className="public-landing__hero" data-testid="landing-hero">
        <p className="public-landing__eyebrow">Open-source speaker operations</p>
        <h1 className="public-landing__title">
          Run your conference programme, end to end.
        </h1>
        <p className="public-landing__lede">
          Call for speakers, review and scoring, speaker onboarding,
          drag-and-drop scheduling, and a beautiful published programme — one
          open-source system, no per-seat SaaS bill.
        </p>
        <div className="public-landing__ctas">
          <Link
            className="public-landing__btn public-landing__btn--primary public-landing__btn--lg lumen-focusable"
            to="/judge"
            data-testid="landing-cta-judge"
          >
            Enter with judge access
          </Link>
          <a
            className="public-landing__btn public-landing__btn--ghost public-landing__btn--lg lumen-focusable"
            href={LEARN_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-cta-docs"
          >
            Explore the docs
          </a>
        </div>
        <p className="public-landing__sub">
          Evaluating for Kill-My-SaaS? The judge code drops you into a fully
          seeded live event.{" "}
          <a
            href="https://github.com/blockbrain-ai/speakerops"
            rel="noopener noreferrer"
            target="_blank"
          >
            Source on GitHub →
          </a>
        </p>
      </section>

      <div
        className="public-landing__cycle"
        data-testid="landing-lifecycle"
        aria-label="Programme lifecycle"
      >
        {LIFECYCLE.map((step, i) => (
          <span key={step.label} className="public-landing__cycle-wrap">
            {i > 0 ? (
              <span className="public-landing__arrow" aria-hidden>
                →
              </span>
            ) : null}
            <span
              className={`public-landing__cyc public-landing__cyc--${step.tone}`}
            >
              <i aria-hidden />
              {step.label}
            </span>
          </span>
        ))}
      </div>

      <section
        className="public-landing__shots"
        data-testid="landing-product-shots"
        aria-label="Product surfaces"
      >
        <div className="public-landing__shots-grid">
          <article className="public-landing__shot public-landing__shot--large">
            <div className="public-landing__shot-cap">
              Programme control — Overview
            </div>
            <div className="public-landing__shot-ph" aria-hidden>
              Overview dashboard · readiness · risks · next actions
            </div>
          </article>
          <div className="public-landing__shots-col">
            <article className="public-landing__shot">
              <div className="public-landing__shot-cap">
                Drag-and-drop schedule
              </div>
              <div className="public-landing__shot-ph" aria-hidden>
                Schedule Studio · conflict-safe
              </div>
            </article>
            <article className="public-landing__shot">
              <div className="public-landing__shot-cap">Speaker portal</div>
              <div className="public-landing__shot-ph" aria-hidden>
                Tasks · bio · calendar
              </div>
            </article>
          </div>
        </div>
      </section>

      <section
        className="public-landing__pillars"
        data-testid="landing-pillars"
        aria-label="Who it serves"
      >
        {PILLARS.map((p) => (
          <article
            key={p.title}
            className={`public-landing__pillar public-landing__pillar--${p.tone}`}
          >
            <div className="public-landing__pillar-ic" aria-hidden>
              {p.icon}
            </div>
            <h2 className="public-landing__pillar-title">{p.title}</h2>
            <p className="public-landing__pillar-body">{p.body}</p>
          </article>
        ))}
      </section>

      <footer className="public-landing__foot" data-testid="landing-footer">
        <span className="public-landing__fine">
          Open source · MIT · Cloudflare-native (Workers + D1)
        </span>
        <a
          href={LEARN_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="landing-footer-docs"
        >
          Documentation
        </a>
        <a
          href={OPENAPI_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="landing-footer-api"
        >
          API
        </a>
        <a
          href="https://github.com/blockbrain-ai/speakerops"
          rel="noopener noreferrer"
          target="_blank"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}

export default PublicLandingPage;
