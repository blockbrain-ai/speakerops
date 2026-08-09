/**
 * Lumen 2 component state sheet — section 11.0 (S-L2-SYSTEM).
 *
 * Review surface for primitives + state anatomy.
 * Inventory: L2-01 · data-testid="l2-state-sheet"
 */
import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Icon,
  ICON_NAMES,
  Modal,
  PageHeader,
  Skeleton,
} from "../components/ui/index.js";

type DemoRow = {
  id: string;
  title: string;
  status: string;
  secondary: string;
};

const DEMO_ROWS: DemoRow[] = [
  {
    id: "row-1",
    title: "Opening keynote",
    status: "Accepted",
    secondary: "sub_01",
  },
  {
    id: "row-2",
    title: "Workshop: accessible forms",
    status: "In review",
    secondary: "sub_02",
  },
  {
    id: "row-3",
    title: "Lightning talks block",
    status: "Draft",
    secondary: "sub_03",
  },
];

export function L2StateSheetPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const columns = useMemo(
    () => [
      {
        id: "title",
        header: "Proposal",
        primary: true,
        cell: (row: DemoRow) => (
          <>
            <span className="l2-table__primary">{row.title}</span>
            <span className="l2-table__secondary">{row.secondary}</span>
          </>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (row: DemoRow) => (
          <Badge
            tone={
              row.status === "Accepted"
                ? "success"
                : row.status === "In review"
                  ? "info"
                  : "neutral"
            }
            showDot
          >
            {row.status}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div
      className="l2-state-sheet"
      data-testid="l2-state-sheet"
      data-section="11.0"
    >
      <PageHeader
        eyebrow="Design system"
        title="Lumen 2 state sheet"
        description="Shared primitives with rest, hover, focus, pressed, disabled, pending, selected, error, empty, and loading states. Tokens live in lumen.css; components consume --lumen-* only."
        data-testid="l2-state-sheet-header"
      />

      {/* Buttons */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-buttons">
        <h2 className="l2-state-sheet__section-title">Button</h2>
        <div className="l2-state-sheet__grid">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="success">Success</Button>
          <Button variant="primary" pending>
            Pending
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" pressed>
            Pressed
          </Button>
          <Button variant="secondary" size="sm">
            Small
          </Button>
          <Button variant="secondary" size="lg">
            Large
          </Button>
          <Button variant="quiet" iconOnly aria-label="Add item">
            <Icon name="plus" decorative />
          </Button>
        </div>
      </section>

      {/* Field */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-fields">
        <h2 className="l2-state-sheet__section-title">Field</h2>
        <div className="l2-state-sheet__stack">
          <Field
            id="l2-field-rest"
            label="Event name"
            hint="Shown on public CFP and portal."
            inputProps={{ defaultValue: "SpeakerOps Summit", name: "event" }}
          />
          <Field
            id="l2-field-error"
            label="Reply-to email"
            error="Enter a valid email so speakers can reach the program team."
            required
            inputProps={{
              defaultValue: "not-an-email",
              name: "reply",
              type: "email",
            }}
          />
          <Field
            id="l2-field-disabled"
            label="Slug"
            disabled
            hint="Locked after publish."
            inputProps={{ defaultValue: "summit-2026", name: "slug" }}
          />
          <Field
            id="l2-field-textarea"
            as="textarea"
            label="Internal notes"
            hint="Not visible to speakers."
            inputProps={{ rows: 3, name: "notes" }}
          />
        </div>
      </section>

      {/* Badge */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-badges">
        <h2 className="l2-state-sheet__section-title">Badge</h2>
        <div className="l2-state-sheet__grid">
          <Badge tone="neutral" showDot>
            Draft
          </Badge>
          <Badge tone="brand" showDot>
            Brand
          </Badge>
          <Badge tone="info" showDot>
            In review
          </Badge>
          <Badge tone="success" showDot>
            Accepted
          </Badge>
          <Badge tone="warn" showDot>
            Waitlist
          </Badge>
          <Badge tone="danger" showDot>
            Rejected
          </Badge>
        </div>
      </section>

      {/* Card */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-cards">
        <h2 className="l2-state-sheet__section-title">Card</h2>
        <div className="l2-state-sheet__grid">
          <Card
            title="Rest card"
            meta="Default surface"
            style={{ width: 240 }}
          >
            Meaningful unit of content with calm spacing.
          </Card>
          <Card
            title="Raised card"
            raised
            meta="Elevation"
            style={{ width: 240 }}
          >
            Shadow indicates actual lift.
          </Card>
          <Card
            title="Selected card"
            selected
            meta="Selection state"
            style={{ width: 240 }}
          >
            Border uses --lumen-border-selected.
          </Card>
        </div>
      </section>

      {/* Alert */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-alerts">
        <h2 className="l2-state-sheet__section-title">Alert</h2>
        <div className="l2-state-sheet__stack">
          <Alert tone="info" title="Audience refreshed">
            Count is current as of the last preview.
          </Alert>
          <Alert tone="success" title="Changes saved">
            Event settings are up to date.
          </Alert>
          <Alert tone="warn" title="CFP closes soon">
            Two days remain before the submission window closes.
          </Alert>
          <Alert tone="danger" title="Couldn’t save changes">
            Check your connection and try again. Your draft is still local.
          </Alert>
        </div>
      </section>

      {/* Modal */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-modal">
        <h2 className="l2-state-sheet__section-title">Modal</h2>
        <Button
          variant="secondary"
          onClick={() => setModalOpen(true)}
          data-testid="l2-state-sheet-open-modal"
        >
          Open confirmation
        </Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Reject this proposal?"
          data-testid="l2-state-sheet-modal"
          footer={
            <>
              <Button variant="quiet" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setModalOpen(false)}>
                Reject proposal
              </Button>
            </>
          }
        >
          Rejecting “Opening keynote” notifies the submitter and removes it from
          the evaluation queue. This cannot be undone from the UI.
        </Modal>
      </section>

      {/* DataTable */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-table">
        <h2 className="l2-state-sheet__section-title">DataTable</h2>
        <DataTable
          data-testid="l2-state-sheet-table"
          columns={columns}
          rows={DEMO_ROWS}
          getRowId={(r) => r.id}
          selectedIds={selected}
          onToggleRow={(id) => {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onToggleAll={(all) => {
            setSelected(
              all ? new Set(DEMO_ROWS.map((r) => r.id)) : new Set(),
            );
          }}
          bulkBar={
            <span>
              {selected.size} selected — bulk actions would appear here
            </span>
          }
        />
      </section>

      {/* EmptyState */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-empty">
        <h2 className="l2-state-sheet__section-title">EmptyState</h2>
        <Card>
          <EmptyState
            data-testid="l2-state-sheet-empty"
            title="No submissions yet"
            description="When speakers submit proposals, they will appear here for review and decisions."
            action={<Button variant="primary">Open CFP form</Button>}
          />
        </Card>
      </section>

      {/* Skeleton */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-skeleton">
        <h2 className="l2-state-sheet__section-title">Skeleton</h2>
        <div className="l2-state-sheet__stack" style={{ maxWidth: 360 }}>
          <Skeleton variant="title" data-testid="l2-skeleton-title" />
          <Skeleton variant="text" />
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="row" />
          <Skeleton variant="rect" height={72} />
        </div>
      </section>

      {/* Icon set */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-icons">
        <h2 className="l2-state-sheet__section-title">Icon</h2>
        <div className="l2-state-sheet__grid">
          {ICON_NAMES.map((name) => (
            <span
              key={name}
              title={name}
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                width: 64,
                fontSize: 11,
                color: "var(--lumen-text-secondary)",
              }}
            >
              <Icon name={name} size="md" decorative />
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* Token smoke */}
      <section className="l2-state-sheet__section" data-testid="l2-sheet-tokens">
        <h2 className="l2-state-sheet__section-title">Token smoke</h2>
        <p className="lumen-type-meta">
          Canvas uses{" "}
          <code style={{ fontFamily: "var(--lumen-font-mono)" }}>
            var(--lumen-bg)
          </code>
          ; action uses{" "}
          <code style={{ fontFamily: "var(--lumen-font-mono)" }}>
            var(--lumen-brand)
          </code>
          . No parallel{" "}
          <code style={{ fontFamily: "var(--lumen-font-mono)" }}>--l2</code>{" "}
          theme SoT.
        </p>
      </section>
    </div>
  );
}
