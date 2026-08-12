/**
 * N6 Preview hub — one place to open admin, public, portal, and embed surfaces
 * for the active event.
 */
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";

type PreviewLink = {
  testId: string;
  title: string;
  desc: string;
  href: string;
  external?: boolean;
};

export function PreviewHubPage() {
  const { activeEventId, activeEvent } = useEventContext();
  const slug = activeEvent?.slug?.trim() || "";

  const links: PreviewLink[] = [
    {
      testId: "preview-admin-overview",
      title: "Admin Overview",
      desc: "Programme control dashboard",
      href: "/admin",
    },
    {
      testId: "preview-admin-cfp",
      title: "CFP builder",
      desc: "Form wizard and publish",
      href: "/admin/cfp",
    },
    {
      testId: "preview-admin-schedule",
      title: "Schedule Studio",
      desc: "Place sessions and resolve conflicts",
      href: "/admin/schedule",
    },
    {
      testId: "preview-portal",
      title: "Speaker portal",
      desc: "Onboarding surface (role-gated)",
      href: activeEventId
        ? `/portal?eventId=${encodeURIComponent(activeEventId)}`
        : "/portal",
    },
  ];

  if (slug) {
    links.push(
      {
        testId: "preview-public-cfp",
        title: "Public CFP",
        desc: `/cfp/${slug}`,
        href: `/cfp/${encodeURIComponent(slug)}`,
        external: true,
      },
      {
        testId: "preview-public-hub",
        title: "Public programme",
        desc: "Sessions / speakers / agenda",
        href: `/e/${encodeURIComponent(slug)}`,
        external: true,
      },
      {
        testId: "preview-embed-sessions",
        title: "Embed · sessions",
        desc: "Iframe-friendly feed",
        href: `/embed/${encodeURIComponent(slug)}/sessions`,
        external: true,
      },
      {
        testId: "preview-embed-gallery",
        title: "Embed · gallery",
        desc: "Speaker portraits feed",
        href: `/embed/${encodeURIComponent(slug)}/gallery`,
        external: true,
      },
    );
  }

  return (
    <div data-testid="page-preview" data-section="n6-preview">
      <PageHeader
        eyebrow="Operator"
        title="Preview hub"
        description="Open the surfaces a judge or speaker will see for this event."
        data-testid="preview-page-header"
      />
      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : (
        <ul className="preview-hub" data-testid="preview-hub-list">
          {links.map((l) => (
            <li key={l.testId}>
              <a
                href={l.href}
                className="preview-hub__card lumen-focusable"
                data-testid={l.testId}
                target={l.external ? "_blank" : undefined}
                rel={l.external ? "noreferrer" : undefined}
              >
                <strong>{l.title}</strong>
                <span>{l.desc}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {activeEventId && !slug ? (
        <p className="eval-queue__muted" data-testid="preview-no-slug">
          This event has no public slug yet — public programme and embeds stay
          unavailable until slug + publish.
        </p>
      ) : null}
    </div>
  );
}
