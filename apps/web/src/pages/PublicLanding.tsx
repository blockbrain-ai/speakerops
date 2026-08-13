/**
 * Public product landing (/) — wave-1 front door (owner-approved mock).
 *
 * Replaces the anonymous redirect to /admin (which surfaced as session-expired).
 * Routes each audience: judge → /judge, organiser → /login,
 * docs → https://learn.speakerops.org (external Learn host, not /learn on this Worker).
 * Sage & Honey · BrandLockup · Lumen control tokens.
 */
import { Link } from "react-router-dom";
import {
  GITHUB_REPO_URL,
  LEARN_DOCS_URL,
  PublicChrome,
} from "../components/public/PublicChrome.js";

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
    <PublicChrome surface="landing">
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
            href={GITHUB_REPO_URL}
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
            <img
              className="public-landing__shot-img"
              src="/landing/shot-overview.png"
              width={1280}
              height={720}
              alt="Admin Overview dashboard showing readiness, risks, and next actions for the programme."
              loading="lazy"
              decoding="async"
            />
          </article>
          <div className="public-landing__shots-col">
            <article className="public-landing__shot">
              <div className="public-landing__shot-cap">
                Drag-and-drop schedule
              </div>
              <img
                className="public-landing__shot-img"
                src="/landing/shot-schedule.png"
                width={960}
                height={640}
                alt="Schedule Studio with conflict-aware placement of sessions into rooms and times."
                loading="lazy"
                decoding="async"
              />
            </article>
            <article className="public-landing__shot">
              <div className="public-landing__shot-cap">Speaker portal</div>
              <img
                className="public-landing__shot-img"
                src="/landing/shot-portal.png"
                width={960}
                height={640}
                alt="Speaker portal showing tasks, profile, and calendar for an accepted speaker."
                loading="lazy"
                decoding="async"
              />
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
    </PublicChrome>
  );
}

export default PublicLandingPage;
