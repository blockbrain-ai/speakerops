/**
 * Form builder admin UI — section 3.2 (S-CFP) + 11.3 Lumen 2 (S-L2-CFP).
 *
 * Inventory D01–D10: create/add fields, reorder, conditionals, category routing,
 * required flags, welcome/thank-you, side-by-side preview, publish, limits, copy link.
 *
 * Lumen 2 composition: outline + canvas + inspector; progressive advanced controls;
 * Build / Public preview / Publish summary views.
 *
 * Wired to Form.Create / Form.List / Form.GetAdmin / Form.UpdateDraftFields / Form.Publish.
 * On event mount, reloads existing form draft so the builder is not blank after refresh.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  FormCreateBodySchema,
  FormCreateResponseSchema,
  FormUpdateDraftResponseSchema,
  FormPublishResponseSchema,
  FormListResponseSchema,
  FormAdminGetResponseSchema,
  ErrorEnvelopeSchema,
  type FormDto,
  type FormVersionDto,
  type FormFieldType,
  type FormFieldDto,
  type FormRuleDto,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";
import { FormPreview } from "../components/forms/FormPreview.js";
import {
  FIELD_PALETTE,
  canPublish,
  defaultOptionsForType,
  hasCircularConditions,
  newClientId,
  publicCfpAbsoluteUrl,
  publishBlockReasons,
  reorderFields,
  toDraftBody,
  uniqueFieldKey,
  type BuilderField,
  type BuilderRule,
} from "../components/forms/form-builder-utils.js";
import { PageHeader } from "../components/ui/PageHeader.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { Alert } from "../components/ui/Alert.js";
import { Field } from "../components/ui/Field.js";

function draftFieldsToBuilder(fields: FormFieldDto[]): BuilderField[] {
  return [...fields]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f, i) => ({
      clientId: newClientId(),
      fieldKey: f.fieldKey,
      type: f.type,
      label: f.label,
      required: f.required,
      options: f.options,
      sortOrder: f.sortOrder ?? i,
      conditions: f.conditions,
      helpText: f.helpText ?? null,
      placeholder: f.placeholder ?? null,
      maxChars: f.maxChars ?? null,
    }));
}

function draftRulesToBuilder(rules: FormRuleDto[]): BuilderRule[] {
  return rules.map((r) => ({
    clientId: newClientId(),
    when: r.when,
    routeToCategory: r.routeToCategory,
  }));
}

type StatusMsg = { kind: "ok" | "error" | "warn"; text: string } | null;

type BuilderView = "build" | "preview" | "publish";

function reasonMessage(reasons: ReturnType<typeof publishBlockReasons>): string {
  if (reasons.includes("no_form")) return "Create a form first";
  if (reasons.includes("no_fields")) return "Add at least one field to publish";
  if (reasons.includes("circular_conditions"))
    return "Circular conditional rules must be fixed before publish";
  if (reasons.includes("missing_options"))
    return "Select fields need options before publish";
  if (reasons.includes("invalid_condition_ref"))
    return "Condition references unknown field_key";
  if (reasons.includes("invalid_rule_ref"))
    return "Routing rule references unknown field_key";
  if (reasons.includes("duplicate_keys")) return "Duplicate field_key values";
  return "Publish blocked";
}

export function FormBuilderPage() {
  const { activeEventId, activeEvent } = useEventContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const [formName, setFormName] = useState("CFP form");
  const [form, setForm] = useState<FormDto | null>(null);
  /** All forms for the event — picker so older forms stay reachable. */
  const [formsList, setFormsList] = useState<FormDto[]>([]);
  const [draftMeta, setDraftMeta] = useState<FormVersionDto | null>(null);
  const [publishedVersion, setPublishedVersion] =
    useState<FormVersionDto | null>(null);

  const [fields, setFields] = useState<BuilderField[]>([]);
  const [rules, setRules] = useState<BuilderRule[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [welcomeMd, setWelcomeMd] = useState("");
  const [thankYouMd, setThankYouMd] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [submissionLimit, setSubmissionLimit] = useState("");
  /** Form settings — configurable speaker bounds (1–15; defaults 1/5). */
  const [minSpeakers, setMinSpeakers] = useState("1");
  const [maxSpeakers, setMaxSpeakers] = useState("5");

  const [createStatus, setCreateStatus] = useState<StatusMsg>(null);
  const [saveStatus, setSaveStatus] = useState<StatusMsg>(null);
  const [publishStatus, setPublishStatus] = useState<StatusMsg>(null);
  const [linkStatus, setLinkStatus] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);
  const [loadExistingStatus, setLoadExistingStatus] = useState<StatusMsg>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  /** Lumen 2 view mode (page-atlas: Build / Public preview / Version summary). */
  const [builderView, setBuilderView] = useState<BuilderView>("build");
  /** Progressive disclosure: form-level advanced (routing, copy, limits). */
  const [formAdvancedOpen, setFormAdvancedOpen] = useState(true);
  /** Progressive disclosure: field conditionals in inspector. */
  const [fieldAdvancedOpen, setFieldAdvancedOpen] = useState(true);

  const selected = useMemo(
    () => fields.find((f) => f.clientId === selectedClientId) ?? null,
    [fields, selectedClientId],
  );

  const applyAdminForm = useCallback(
    (payload: {
      form: FormDto;
      draft: FormVersionDto;
      published?: FormVersionDto | null;
    }) => {
      setForm(payload.form);
      setFormName(payload.form.name);
      setDraftMeta(payload.draft);
      setPublishedVersion(payload.published ?? null);
      setFields(draftFieldsToBuilder(payload.draft.fields ?? []));
      setRules(draftRulesToBuilder(payload.draft.rules ?? []));
      setWelcomeMd(payload.draft.welcomeMd ?? "");
      setThankYouMd(payload.draft.thankYouMd ?? "");
      setOpensAt(payload.draft.opensAt ?? "");
      setClosesAt(payload.draft.closesAt ?? "");
      setSubmissionLimit(
        payload.draft.submissionLimit != null
          ? String(payload.draft.submissionLimit)
          : "",
      );
      setMinSpeakers(String(payload.draft.minSpeakers ?? 1));
      setMaxSpeakers(String(payload.draft.maxSpeakers ?? 5));
      setSelectedClientId(null);
      setBuilderView("build");
    },
    [],
  );

  /**
   * Reset builder state when the active event changes so Save/Publish cannot
   * mutate a form belonging to a previous event while Copy public link uses
   * the newly selected event slug. Then load existing forms for the event.
   */
  useEffect(() => {
    setFormName("CFP form");
    setForm(null);
    setFormsList([]);
    setDraftMeta(null);
    setPublishedVersion(null);
    setFields([]);
    setRules([]);
    setSelectedClientId(null);
    setWelcomeMd("");
    setThankYouMd("");
    setOpensAt("");
    setClosesAt("");
    setSubmissionLimit("");
    setMinSpeakers("1");
    setMaxSpeakers("5");
    setCreateStatus(null);
    setSaveStatus(null);
    setPublishStatus(null);
    setLinkStatus(null);
    setLoadExistingStatus(null);
    setBusy(false);
    setDragIndex(null);
    setBuilderView("build");
    setFormAdvancedOpen(true);
    setFieldAdvancedOpen(true);

    if (!activeEventId) return;

    let cancelled = false;
    const preferFormId = searchParams.get("form");

    (async () => {
      setBusy(true);
      try {
        const listRes = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/forms`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled) return;
        if (!listRes.ok) {
          // Empty builder is fine when list fails (auth / no forms).
          setLoadExistingStatus(null);
          return;
        }
        const listRaw: unknown = await listRes.json();
        const listParsed = FormListResponseSchema.safeParse(listRaw);
        if (!listParsed.success || listParsed.data.forms.length === 0) {
          return;
        }
        const forms = listParsed.data.forms;
        setFormsList(forms);
        const target =
          (preferFormId
            ? forms.find((f) => f.id === preferFormId)
            : undefined) ?? forms[0]!;

        const getRes = await fetch(
          `/api/forms/${encodeURIComponent(target.id)}`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled) return;
        if (!getRes.ok) {
          setLoadExistingStatus({
            kind: "error",
            text: "Could not load existing form draft",
          });
          return;
        }
        const getRaw: unknown = await getRes.json();
        const getParsed = FormAdminGetResponseSchema.safeParse(getRaw);
        if (!getParsed.success) {
          setLoadExistingStatus({
            kind: "error",
            text: "Unexpected form detail response",
          });
          return;
        }
        applyAdminForm({
          form: getParsed.data.form,
          draft: getParsed.data.draft,
          published: getParsed.data.published ?? null,
        });
        setLoadExistingStatus({
          kind: "ok",
          text: `Loaded “${getParsed.data.form.name}”`,
        });
      } catch {
        if (!cancelled) {
          setLoadExistingStatus({
            kind: "error",
            text: "Network error loading forms",
          });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // searchParams form is intentional for ?form= deep link
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount load on event / ?form=
  }, [activeEventId, searchParams, applyAdminForm]);

  const blockReasons = useMemo(
    () =>
      publishBlockReasons({
        formId: form?.id ?? null,
        fields,
        rules,
      }),
    [form?.id, fields, rules],
  );
  const publishEnabled = canPublish({
    formId: form?.id ?? null,
    fields,
    rules,
  });
  const circular = hasCircularConditions(fields);

  /** Human validation for the speaker-bounds knob (1–15, min ≤ max). */
  const speakerBoundsError = useMemo(() => {
    const min = Number(minSpeakers);
    const max = Number(maxSpeakers);
    if (!Number.isInteger(min) || min < 1 || min > 15) {
      return "Minimum speakers must be a whole number between 1 and 15";
    }
    if (!Number.isInteger(max) || max < 1 || max > 15) {
      return "Maximum speakers must be a whole number between 1 and 15";
    }
    if (min > max) {
      return "Minimum speakers cannot exceed maximum speakers";
    }
    return null;
  }, [minSpeakers, maxSpeakers]);

  const eventSlug = activeEvent?.slug ?? null;

  const updateField = useCallback(
    (clientId: string, patch: Partial<BuilderField>) => {
      setFields((prev) =>
        prev.map((f) => (f.clientId === clientId ? { ...f, ...patch } : f)),
      );
    },
    [],
  );

  function addField(type: FormFieldType, keyPrefix: string, defaultLabel: string) {
    setFields((prev) => {
      const fieldKey = uniqueFieldKey(
        keyPrefix,
        prev.map((f) => f.fieldKey),
      );
      const next: BuilderField = {
        clientId: newClientId(),
        fieldKey,
        type,
        label: defaultLabel,
        required: false,
        options: defaultOptionsForType(type),
        sortOrder: prev.length,
        conditions: null,
      };
      setSelectedClientId(next.clientId);
      return [...prev, next];
    });
    setSaveStatus(null);
    setBuilderView("build");
  }

  function removeField(clientId: string) {
    setFields((prev) => {
      const next = prev
        .filter((f) => f.clientId !== clientId)
        .map((f, i) => ({ ...f, sortOrder: i }));
      return next;
    });
    if (selectedClientId === clientId) setSelectedClientId(null);
  }

  function moveField(index: number, direction: -1 | 1) {
    const to = index + direction;
    setFields((prev) => reorderFields(prev, index, to));
  }

  /** Open an existing form via ?form= deep link (mount effect reloads it). */
  function onPickForm(formId: string) {
    if (!formId || formId === form?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set("form", formId);
    setSearchParams(next, { replace: true });
  }

  async function onCreateForm(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId) {
      setCreateStatus({ kind: "error", text: "Select an active event first" });
      return;
    }
    setBusy(true);
    setCreateStatus(null);
    const body = { name: formName.trim() || "CFP form" };
    const valid = FormCreateBodySchema.safeParse(body);
    if (!valid.success) {
      setCreateStatus({ kind: "error", text: "Validation failed" });
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/forms`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(valid.data),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setCreateStatus({
          kind: "error",
          text: env.success ? env.data.error : `Create failed (${res.status})`,
        });
        return;
      }
      const parsed = FormCreateResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setCreateStatus({ kind: "error", text: "Unexpected create response" });
        return;
      }
      setForm(parsed.data.form);
      setFormsList((prev) => [
        parsed.data.form,
        ...prev.filter((f) => f.id !== parsed.data.form.id),
      ]);
      setDraftMeta(parsed.data.draft);
      setPublishedVersion(null);
      setFields([]);
      setRules([]);
      setWelcomeMd("");
      setThankYouMd("");
      setOpensAt("");
      setClosesAt("");
      setSubmissionLimit("");
      setMinSpeakers(String(parsed.data.draft.minSpeakers ?? 1));
      setMaxSpeakers(String(parsed.data.draft.maxSpeakers ?? 5));
      setSelectedClientId(null);
      setCreateStatus({
        kind: "ok",
        text: `Created form “${parsed.data.form.name}” (${parsed.data.form.id})`,
      });
      setPublishStatus(null);
      setSaveStatus(null);
      setBuilderView("build");
    } catch {
      setCreateStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(): Promise<FormVersionDto | null> {
    if (!form) {
      setSaveStatus({ kind: "error", text: "Create a form first" });
      return null;
    }
    if (circular) {
      setSaveStatus({
        kind: "error",
        text: "Circular condition field_key dependency — fix before save",
      });
      return null;
    }
    if (speakerBoundsError) {
      setSaveStatus({ kind: "error", text: speakerBoundsError });
      return null;
    }
    const body = toDraftBody({
      fields,
      rules,
      welcomeMd,
      thankYouMd,
      opensAt,
      closesAt,
      submissionLimit,
      minSpeakers,
      maxSpeakers,
    });
    const res = await fetch(`/api/forms/${encodeURIComponent(form.id)}/draft`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const env = ErrorEnvelopeSchema.safeParse(raw);
      setSaveStatus({
        kind: "error",
        text: env.success ? env.data.error : `Save failed (${res.status})`,
      });
      return null;
    }
    const parsed = FormUpdateDraftResponseSchema.safeParse(raw);
    if (!parsed.success) {
      setSaveStatus({ kind: "error", text: "Unexpected draft response" });
      return null;
    }
    setDraftMeta(parsed.data.formVersion);
    setSaveStatus({
      kind: "ok",
      text: `Draft saved (${parsed.data.formVersion.fields.length} fields)`,
    });
    return parsed.data.formVersion;
  }

  async function onSaveDraft(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setSaveStatus(null);
    try {
      await saveDraft();
    } catch {
      setSaveStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    if (!form || !publishEnabled) return;
    setBusy(true);
    setPublishStatus(null);
    try {
      const draft = await saveDraft();
      if (!draft) {
        setBusy(false);
        return;
      }
      const res = await fetch(
        `/api/forms/${encodeURIComponent(form.id)}/publish`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setPublishStatus({
          kind: "error",
          text: env.success
            ? env.data.error
            : `Publish failed (${res.status})`,
        });
        return;
      }
      const parsed = FormPublishResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setPublishStatus({ kind: "error", text: "Unexpected publish response" });
        return;
      }
      setForm(parsed.data.form);
      setFormsList((prev) =>
        prev.map((f) => (f.id === parsed.data.form.id ? parsed.data.form : f)),
      );
      setPublishedVersion(parsed.data.formVersion);
      setPublishStatus({
        kind: "ok",
        text: `Published version ${parsed.data.formVersion.versionNum} (immutable snapshot)`,
      });
      // Stay on current view so palette/canvas remain available for further edits
      // (D08: publish then add fields and re-publish). User can open Publish summary tab.
    } catch {
      setPublishStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function onCopyLink() {
    if (!eventSlug) {
      setLinkStatus({
        kind: "error",
        text: "Event slug unavailable — create/select an event with a slug",
      });
      return;
    }
    const url = publicCfpAbsoluteUrl(window.location.origin, eventSlug);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setLinkStatus({ kind: "ok", text: `Copied ${url}` });
    } catch {
      setLinkStatus({ kind: "error", text: `Copy failed — ${url}` });
    }
  }

  function onFieldListKeyDown(e: KeyboardEvent, index: number) {
    if (e.key === "ArrowUp" && (e.altKey || e.metaKey)) {
      e.preventDefault();
      moveField(index, -1);
    } else if (e.key === "ArrowDown" && (e.altKey || e.metaKey)) {
      e.preventDefault();
      moveField(index, 1);
    }
  }

  function setCondition(
    clientId: string,
    showWhen: BuilderField["conditions"],
  ) {
    updateField(clientId, { conditions: showWhen });
  }

  function addRule() {
    const firstKey = fields[0]?.fieldKey ?? "category";
    setRules((prev) => [
      ...prev,
      {
        clientId: newClientId(),
        when: { fieldKey: firstKey, op: "eq", value: "" },
        routeToCategory: "",
      },
    ]);
    setFormAdvancedOpen(true);
  }

  function updateRule(clientId: string, patch: Partial<BuilderRule>) {
    setRules((prev) =>
      prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)),
    );
  }

  function removeRule(clientId: string) {
    setRules((prev) => prev.filter((r) => r.clientId !== clientId));
  }

  const otherFieldKeys = fields
    .filter((f) => f.clientId !== selected?.clientId)
    .map((f) => f.fieldKey);

  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => a.sortOrder - b.sortOrder),
    [fields],
  );

  return (
    <div
      className="form-builder"
      data-testid="page-cfp"
      data-section="11.3"
      data-form-id={form?.id ?? ""}
      data-form-status={form?.status ?? "none"}
      data-builder-view={builderView}
      data-layout="outline-canvas-inspector"
    >
      <PageHeader
        eyebrow="Call for proposals"
        title="Form builder"
        description="Outline, canvas, and inspector — progressive advanced controls. Publish freezes an immutable version."
        data-testid="form-builder-page-header"
        actions={
          form ? (
            <div className="form-builder__header-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="form-save-draft"
                onClick={() => void onSaveDraft()}
                disabled={busy || !form}
                pending={busy && saveStatus === null}
              >
                Save draft
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="form-publish"
                onClick={() => void onPublish()}
                disabled={busy || !publishEnabled}
                aria-disabled={!publishEnabled}
                title={
                  publishEnabled
                    ? "Publish immutable version"
                    : reasonMessage(blockReasons)
                }
              >
                Publish
              </Button>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                data-testid="form-copy-link"
                onClick={() => void onCopyLink()}
                disabled={!eventSlug}
              >
                Copy public link
              </Button>
              <p
                className="form-builder__muted form-builder__publish-consequence"
                data-testid="form-publish-consequence"
              >
                Publishing makes this version the live public CFP form for this
                event.
              </p>
            </div>
          ) : null
        }
      />

      {!activeEventId ? (
        <p className="form-builder__empty" data-testid="form-builder-no-event">
          Select or create an event (Settings) before building a form.
        </p>
      ) : null}

      {/* D01 — create form */}
      <section
        className="form-builder__card"
        data-testid="form-create-section"
        aria-labelledby="form-create-heading"
      >
        {formsList.length > 0 ? (
          <div
            className="form-builder__form-row"
            data-testid="form-builder-picker-row"
          >
            <label className="form-builder__label" htmlFor="form-builder-picker">
              Open existing form
            </label>
            <select
              id="form-builder-picker"
              className="form-builder__input lumen-focusable"
              data-testid="form-builder-picker"
              value={form?.id ?? ""}
              onChange={(e) => onPickForm(e.target.value)}
              disabled={busy}
            >
              {!form ? <option value="">Select a form…</option> : null}
              {formsList.map((f) => (
                <option
                  key={f.id}
                  value={f.id}
                  data-testid={`form-builder-picker-option-${f.id}`}
                >
                  {f.name} · {f.status}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <h3 id="form-create-heading" className="form-builder__heading">
          Create form
        </h3>
        <form
          className="form-builder__form-row"
          onSubmit={onCreateForm}
          data-testid="form-create-form"
        >
          <label className="form-builder__label" htmlFor="form-create-name">
            Name
          </label>
          <input
            id="form-create-name"
            className="form-builder__input lumen-focusable"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            data-testid="form-create-name"
            disabled={busy || !activeEventId}
          />
          <button
            type="submit"
            className="form-builder__btn form-builder__btn--primary lumen-focusable"
            data-testid="form-create-submit"
            disabled={busy || !activeEventId}
          >
            Create form
          </button>
        </form>
        {createStatus ? (
          <p
            className={`form-builder__status form-builder__status--${createStatus.kind}`}
            data-testid="form-create-status"
            role="status"
          >
            {createStatus.text}
          </p>
        ) : null}
        {loadExistingStatus ? (
          <p
            className={`form-builder__status form-builder__status--${loadExistingStatus.kind}`}
            data-testid="form-load-status"
            role="status"
          >
            {loadExistingStatus.text}
          </p>
        ) : null}
        {form ? (
          <p className="form-builder__meta" data-testid="form-shell-meta">
            Form <code data-testid="form-id">{form.id}</code> · status{" "}
            <Badge
              tone={form.status === "published" ? "success" : "neutral"}
              data-testid="form-status-badge"
            >
              <span data-testid="form-status">{form.status}</span>
            </Badge>
            {publishedVersion ? (
              <>
                {" "}
                · last published v
                <span data-testid="form-published-version">
                  {publishedVersion.versionNum}
                </span>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      {form ? (
        <>
          {/* View mode switcher — Build / Public preview / Publish summary */}
          <nav
            className="form-builder__view-tabs"
            data-testid="form-builder-view-tabs"
            aria-label="Builder views"
          >
            {(
              [
                { id: "build" as const, label: "Build", testId: "builder-view-build" },
                {
                  id: "preview" as const,
                  label: "Public preview",
                  testId: "builder-view-preview",
                },
                {
                  id: "publish" as const,
                  label: "Publish summary",
                  testId: "builder-view-publish",
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={
                  builderView === tab.id
                    ? "form-builder__view-tab is-active lumen-focusable"
                    : "form-builder__view-tab lumen-focusable"
                }
                data-testid={tab.testId}
                aria-current={builderView === tab.id ? "page" : undefined}
                onClick={() => setBuilderView(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {builderView === "build" ? (
            <div
              className="form-builder__workspace form-builder__workspace--l2"
              data-testid="form-builder-workspace"
              data-regions="outline-canvas-inspector"
            >
              {/* —— Outline (left) —— */}
              <aside
                className="form-builder__outline form-builder__card"
                data-testid="builder-outline"
                aria-labelledby="builder-outline-heading"
              >
                <h3 id="builder-outline-heading" className="form-builder__heading">
                  Outline
                </h3>

                <section
                  data-testid="field-palette"
                  aria-labelledby="palette-heading"
                >
                  <h4 id="palette-heading" className="form-builder__subheading">
                    Field palette
                  </h4>
                  <div className="form-builder__palette-grid">
                    {FIELD_PALETTE.map((p) => (
                      <button
                        key={p.testId}
                        type="button"
                        className="form-builder__btn form-builder__btn--secondary lumen-focusable"
                        data-testid={p.testId}
                        data-field-type={p.type}
                        onClick={() =>
                          addField(p.type, p.keyPrefix, p.defaultLabel)
                        }
                        disabled={busy}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section
                  className="form-builder__outline-list-wrap"
                  aria-labelledby="outline-list-heading"
                >
                  <h4 id="outline-list-heading" className="form-builder__subheading">
                    Sections
                  </h4>
                  {sortedFields.length === 0 ? (
                    <p className="form-builder__muted" data-testid="outline-empty">
                      No fields yet
                    </p>
                  ) : (
                    <ol
                      className="form-builder__outline-list"
                      data-testid="builder-outline-list"
                    >
                      {sortedFields.map((f, index) => (
                        <li key={f.clientId}>
                          <button
                            type="button"
                            className={
                              f.clientId === selectedClientId
                                ? "form-builder__outline-item is-selected lumen-focusable"
                                : "form-builder__outline-item lumen-focusable"
                            }
                            data-testid={`outline-item-${f.fieldKey}`}
                            aria-current={
                              f.clientId === selectedClientId
                                ? "true"
                                : undefined
                            }
                            onClick={() => setSelectedClientId(f.clientId)}
                          >
                            <span className="form-builder__outline-index">
                              {index + 1}
                            </span>
                            <span className="form-builder__outline-label">
                              {f.label}
                            </span>
                            {f.required ? (
                              <span className="form-builder__outline-req">*</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </aside>

              {/* —— Canvas (centre) —— */}
              <div
                className="form-builder__canvas"
                data-testid="builder-canvas"
                aria-labelledby="builder-canvas-heading"
              >
                <section
                  className="form-builder__card"
                  data-testid="field-list-section"
                  aria-labelledby="field-list-heading"
                >
                  <h3
                    id="field-list-heading"
                    className="form-builder__heading"
                  >
                    <span id="builder-canvas-heading">Form canvas</span>
                  </h3>
                  {fields.length === 0 ? (
                    <p
                      className="form-builder__empty"
                      data-testid="field-list-empty"
                    >
                      No fields yet. Use the palette to add text, select, file URL,
                      or speaker fields.
                    </p>
                  ) : (
                    <ul
                      className="form-builder__field-list"
                      data-testid="field-list"
                      aria-label="Form fields"
                    >
                      {fields.map((f, index) => (
                        <li
                          key={f.clientId}
                          className={
                            f.clientId === selectedClientId
                              ? "form-builder__field-item form-builder__field-item--selected"
                              : "form-builder__field-item"
                          }
                          data-testid={`field-item-${f.fieldKey}`}
                          data-field-key={f.fieldKey}
                          data-sort-order={f.sortOrder}
                          draggable
                          onDragStart={() => setDragIndex(index)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragIndex == null) return;
                            setFields((prev) =>
                              reorderFields(prev, dragIndex, index),
                            );
                            setDragIndex(null);
                          }}
                          onDragEnd={() => setDragIndex(null)}
                          onKeyDown={(e) => onFieldListKeyDown(e, index)}
                        >
                          <button
                            type="button"
                            className="form-builder__field-select lumen-focusable"
                            data-testid={`field-select-${f.fieldKey}`}
                            onClick={() => setSelectedClientId(f.clientId)}
                            aria-pressed={f.clientId === selectedClientId}
                          >
                            <span
                              className="form-builder__field-label"
                              data-testid={`field-label-${f.fieldKey}`}
                            >
                              {f.label}
                            </span>
                            <span className="form-builder__muted">
                              {" "}
                              ({f.type}
                              {f.required ? ", required" : ""})
                            </span>
                          </button>
                          <div className="form-builder__field-actions">
                            <button
                              type="button"
                              className="form-builder__btn form-builder__btn--ghost lumen-focusable"
                              data-testid={`field-move-up-${f.fieldKey}`}
                              aria-label={`Move ${f.label} up`}
                              disabled={index === 0 || busy}
                              onClick={() => moveField(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="form-builder__btn form-builder__btn--ghost lumen-focusable"
                              data-testid={`field-move-down-${f.fieldKey}`}
                              aria-label={`Move ${f.label} down`}
                              disabled={index === fields.length - 1 || busy}
                              onClick={() => moveField(index, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="form-builder__btn form-builder__btn--ghost lumen-focusable"
                              data-testid={`field-remove-${f.fieldKey}`}
                              aria-label={`Remove ${f.label}`}
                              disabled={busy}
                              onClick={() => removeField(f.clientId)}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* D07 — side-by-side live preview stays in workspace */}
                <aside
                  className="form-builder__preview-col form-builder__card"
                  aria-labelledby="form-preview-heading"
                >
                  <FormPreview
                    fields={fields}
                    welcomeMd={welcomeMd}
                    thankYouMd={thankYouMd}
                  />
                </aside>
              </div>

              {/* —— Inspector (right) —— */}
              <aside
                className="form-builder__inspector form-builder__card"
                data-testid="builder-inspector"
                aria-labelledby="field-editor-heading"
              >
                <section data-testid="field-editor-section">
                  <h3 id="field-editor-heading" className="form-builder__heading">
                    Inspector
                  </h3>
                  {!selected ? (
                    <p
                      className="form-builder__muted"
                      data-testid="field-editor-empty"
                    >
                      Select a field on the canvas or outline to edit label,
                      required flag, options, and conditionals.
                    </p>
                  ) : (
                    <div
                      className="form-builder__field-editor"
                      data-testid="field-editor"
                      data-editing-key={selected.fieldKey}
                    >
                      <label
                        className="form-builder__label"
                        htmlFor="field-edit-label"
                      >
                        Label
                      </label>
                      <input
                        id="field-edit-label"
                        className="form-builder__input lumen-focusable"
                        value={selected.label}
                        onChange={(e) =>
                          updateField(selected.clientId, {
                            label: e.target.value,
                          })
                        }
                        data-testid="field-edit-label"
                      />

                      <label
                        className="form-builder__label"
                        htmlFor="field-edit-key"
                      >
                        Field key
                      </label>
                      <input
                        id="field-edit-key"
                        className="form-builder__input lumen-focusable"
                        value={selected.fieldKey}
                        onChange={(e) =>
                          updateField(selected.clientId, {
                            fieldKey: e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_]/g, "")
                              .slice(0, 64),
                          })
                        }
                        data-testid="field-edit-key"
                        pattern="[a-z][a-z0-9_]*"
                      />

                      <label className="form-builder__check-row">
                        <input
                          type="checkbox"
                          className="lumen-focusable"
                          checked={selected.required}
                          onChange={(e) =>
                            updateField(selected.clientId, {
                              required: e.target.checked,
                            })
                          }
                          data-testid="field-edit-required"
                        />
                        <span>Required</span>
                      </label>

                      {/* Post-11.9 depth — help text / placeholder / character limit */}
                      <Field
                        id="field-edit-help"
                        as="textarea"
                        label="Help text"
                        hint="Guidance shown under the label on the public form."
                        inputProps={{
                          rows: 2,
                          maxLength: 500,
                          value: selected.helpText ?? "",
                          onChange: (e) =>
                            updateField(selected.clientId, {
                              helpText: e.target.value,
                            }),
                          "data-testid": "field-edit-help",
                        }}
                      />
                      <Field
                        id="field-edit-placeholder"
                        label="Placeholder"
                        hint="Ghost copy inside the empty input."
                        inputProps={{
                          maxLength: 200,
                          value: selected.placeholder ?? "",
                          onChange: (e) =>
                            updateField(selected.clientId, {
                              placeholder: e.target.value,
                            }),
                          "data-testid": "field-edit-placeholder",
                        }}
                      />
                      {selected.type === "text" ||
                      selected.type === "textarea" ? (
                        <Field
                          id="field-edit-maxchars"
                          label="Character limit"
                          hint="Longer answers are rejected — submitters see a live counter."
                          inputProps={{
                            type: "number",
                            min: 1,
                            max: 50_000,
                            value:
                              selected.maxChars != null
                                ? String(selected.maxChars)
                                : "",
                            onChange: (e) => {
                              const raw = e.target.value.trim();
                              const n = Number(raw);
                              updateField(selected.clientId, {
                                maxChars:
                                  raw.length > 0 &&
                                  Number.isInteger(n) &&
                                  n > 0
                                    ? n
                                    : null,
                              });
                            },
                            "data-testid": "field-edit-maxchars",
                          }}
                        />
                      ) : null}

                      {(selected.type === "select" ||
                        selected.type === "multiselect") && (
                        <>
                          <label
                            className="form-builder__label"
                            htmlFor="field-edit-options"
                          >
                            Options (value|label per line)
                          </label>
                          <textarea
                            id="field-edit-options"
                            className="form-builder__input lumen-focusable"
                            rows={4}
                            value={(selected.options ?? [])
                              .map((o) => `${o.value}|${o.label}`)
                              .join("\n")}
                            onChange={(e) => {
                              const options = e.target.value
                                .split("\n")
                                .map((line) => line.trim())
                                .filter(Boolean)
                                .map((line) => {
                                  const [value, ...rest] = line.split("|");
                                  const label = rest.join("|") || value || "";
                                  return {
                                    value: (value || label).trim(),
                                    label: label.trim(),
                                  };
                                })
                                .filter((o) => o.value.length > 0);
                              updateField(selected.clientId, {
                                options: options.length > 0 ? options : null,
                              });
                            }}
                            data-testid="field-edit-options"
                          />
                        </>
                      )}

                      {/* Progressive: advanced conditionals */}
                      <div
                        className="form-builder__disclosure"
                        data-testid="field-advanced-disclosure"
                      >
                        <button
                          type="button"
                          className="form-builder__disclosure-toggle lumen-focusable"
                          data-testid="field-advanced-toggle"
                          aria-expanded={fieldAdvancedOpen}
                          onClick={() => setFieldAdvancedOpen((v) => !v)}
                        >
                          {fieldAdvancedOpen ? "Hide" : "Show"} advanced
                          (conditionals)
                        </button>
                        {fieldAdvancedOpen ? (
                          <fieldset
                            className="form-builder__fieldset"
                            data-testid="field-condition-editor"
                          >
                            <legend className="form-builder__label">
                              Conditional (show when)
                            </legend>
                            <label className="form-builder__check-row">
                              <input
                                type="checkbox"
                                className="lumen-focusable"
                                checked={Boolean(selected.conditions?.showWhen)}
                                onChange={(e) => {
                                  if (!e.target.checked) {
                                    setCondition(selected.clientId, null);
                                    return;
                                  }
                                  const dep = otherFieldKeys[0] ?? "";
                                  setCondition(selected.clientId, {
                                    showWhen: {
                                      fieldKey: dep || "category",
                                      op: "eq",
                                      value: "",
                                    },
                                  });
                                }}
                                data-testid="field-condition-enabled"
                                disabled={otherFieldKeys.length === 0}
                              />
                              <span>Show only when another field matches</span>
                            </label>
                            {selected.conditions?.showWhen ? (
                              <div className="form-builder__condition-row">
                                <label
                                  className="form-builder__label"
                                  htmlFor="cond-field"
                                >
                                  Field
                                </label>
                                <select
                                  id="cond-field"
                                  className="form-builder__input lumen-focusable"
                                  value={selected.conditions.showWhen.fieldKey}
                                  onChange={(e) =>
                                    setCondition(selected.clientId, {
                                      showWhen: {
                                        ...selected.conditions!.showWhen!,
                                        fieldKey: e.target.value,
                                      },
                                    })
                                  }
                                  data-testid="field-condition-field"
                                >
                                  {otherFieldKeys.map((k) => (
                                    <option key={k} value={k}>
                                      {k}
                                    </option>
                                  ))}
                                </select>
                                <label
                                  className="form-builder__label"
                                  htmlFor="cond-value"
                                >
                                  Equals
                                </label>
                                <input
                                  id="cond-value"
                                  className="form-builder__input lumen-focusable"
                                  value={String(
                                    selected.conditions.showWhen.value,
                                  )}
                                  onChange={(e) =>
                                    setCondition(selected.clientId, {
                                      showWhen: {
                                        ...selected.conditions!.showWhen!,
                                        value: e.target.value,
                                      },
                                    })
                                  }
                                  data-testid="field-condition-value"
                                />
                              </div>
                            ) : null}
                            {circular ? (
                              <p
                                className="form-builder__status form-builder__status--error"
                                data-testid="field-condition-cycle-error"
                                role="alert"
                              >
                                Circular condition field_key dependency — blocked
                              </p>
                            ) : null}
                          </fieldset>
                        ) : null}
                      </div>
                    </div>
                  )}
                </section>
              </aside>
            </div>
          ) : null}

          {builderView === "preview" ? (
            <div
              className="form-builder__workspace form-builder__workspace--preview"
              data-testid="form-builder-workspace"
              data-regions="preview"
            >
              <div className="form-builder__card form-builder__preview-full">
                <FormPreview
                  fields={fields}
                  welcomeMd={welcomeMd}
                  thankYouMd={thankYouMd}
                />
              </div>
              {/* Keep palette reachable for D07-style checks when switched back */}
              <p className="form-builder__muted">
                Public preview uses the draft renderer. Switch to Build to edit
                fields.
              </p>
            </div>
          ) : null}

          {builderView === "publish" ? (
            <div
              className="form-builder__workspace form-builder__workspace--publish"
              data-testid="form-builder-workspace"
              data-regions="publish"
            >
              <section
                className="form-builder__card"
                data-testid="form-publish-summary"
                aria-labelledby="publish-summary-heading"
              >
                <h3
                  id="publish-summary-heading"
                  className="form-builder__heading"
                >
                  Publish summary
                </h3>
                <p className="form-builder__meta">
                  Fields ready: <strong>{fields.length}</strong>
                  {rules.length > 0 ? ` · ${rules.length} routing rule(s)` : ""}
                  {publishedVersion
                    ? ` · last published v${publishedVersion.versionNum}`
                    : " · never published"}
                </p>
                {!publishEnabled ? (
                  <Alert
                    tone="warn"
                    title="Publish blocked"
                    data-testid="form-publish-blocked-alert"
                  >
                    {reasonMessage(blockReasons)}
                  </Alert>
                ) : (
                  <Alert tone="info" title="Ready to publish">
                    Publishing freezes an immutable form version. New submissions
                    pin to that version. Publishing makes this version the live
                    public CFP form for this event.
                  </Alert>
                )}
                <ul className="form-builder__publish-field-list" data-testid="publish-field-list">
                  {sortedFields.map((f) => (
                    <li key={f.clientId}>
                      {f.label}{" "}
                      <span className="form-builder__muted">
                        ({f.fieldKey}
                        {f.required ? ", required" : ""})
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}

          {/* Form settings — configurable knobs frozen into the next published
              version. New home for future per-form settings (post-11.9 depth). */}
          <section
            className="form-builder__card form-builder__settings"
            data-testid="form-settings-panel"
            aria-labelledby="form-settings-heading"
          >
            <div className="form-builder__settings-head">
              <h3 id="form-settings-heading" className="form-builder__heading">
                Form settings
              </h3>
              <p className="form-builder__muted">
                How submitters propose speakers on this form. Saved with the
                draft and frozen into the next published version.
              </p>
            </div>
            <div className="form-builder__settings-grid">
              <Field
                id="form-min-speakers"
                label="Minimum speakers"
                hint="Fewest speakers a proposal must include (1–15)."
                inputProps={{
                  type: "number",
                  min: 1,
                  max: 15,
                  inputMode: "numeric",
                  value: minSpeakers,
                  onChange: (e) => setMinSpeakers(e.target.value),
                  "data-testid": "form-min-speakers",
                }}
              />
              <Field
                id="form-max-speakers"
                label="Maximum speakers"
                hint="Most speakers a proposal can include (1–15)."
                inputProps={{
                  type: "number",
                  min: 1,
                  max: 15,
                  inputMode: "numeric",
                  value: maxSpeakers,
                  onChange: (e) => setMaxSpeakers(e.target.value),
                  "data-testid": "form-max-speakers",
                }}
              />
            </div>
            {speakerBoundsError ? (
              <Alert
                tone="warn"
                title="Check speaker bounds"
                data-testid="form-settings-error"
              >
                {speakerBoundsError}
              </Alert>
            ) : null}
          </section>

          {/* Progressive: form-level advanced (routing, copy, limits) — open by default for inventory */}
          <div
            className="form-builder__disclosure form-builder__card"
            data-testid="form-advanced-disclosure"
          >
            <button
              type="button"
              className="form-builder__disclosure-toggle lumen-focusable"
              data-testid="form-advanced-toggle"
              aria-expanded={formAdvancedOpen}
              onClick={() => setFormAdvancedOpen((v) => !v)}
            >
              {formAdvancedOpen ? "Hide" : "Show"} advanced form settings
              (routing, copy, limits)
            </button>

            {formAdvancedOpen ? (
              <div
                className="form-builder__advanced-body"
                data-testid="form-advanced-body"
              >
                {/* D04 — category routing */}
                <section
                  data-testid="rules-editor-section"
                  aria-labelledby="rules-heading"
                >
                  <h3 id="rules-heading" className="form-builder__heading">
                    Category routing
                  </h3>
                  <p className="form-builder__muted">
                    Route submissions to a category when a field matches.
                  </p>
                  <ul className="form-builder__rules" data-testid="rules-list">
                    {rules.map((r, i) => (
                      <li
                        key={r.clientId}
                        className="form-builder__rule"
                        data-testid={`rule-item-${i}`}
                      >
                        <label className="form-builder__label">When field</label>
                        <select
                          className="form-builder__input lumen-focusable"
                          value={r.when.fieldKey}
                          onChange={(e) =>
                            updateRule(r.clientId, {
                              when: { ...r.when, fieldKey: e.target.value },
                            })
                          }
                          data-testid={`rule-field-${i}`}
                        >
                          {fields.map((f) => (
                            <option key={f.fieldKey} value={f.fieldKey}>
                              {f.fieldKey}
                            </option>
                          ))}
                        </select>
                        <label className="form-builder__label">Equals</label>
                        <input
                          className="form-builder__input lumen-focusable"
                          value={String(r.when.value)}
                          onChange={(e) =>
                            updateRule(r.clientId, {
                              when: { ...r.when, value: e.target.value },
                            })
                          }
                          data-testid={`rule-value-${i}`}
                        />
                        <label className="form-builder__label">
                          Route to category
                        </label>
                        <input
                          className="form-builder__input lumen-focusable"
                          value={r.routeToCategory}
                          onChange={(e) =>
                            updateRule(r.clientId, {
                              routeToCategory: e.target.value,
                            })
                          }
                          data-testid={`rule-category-${i}`}
                        />
                        <button
                          type="button"
                          className="form-builder__btn form-builder__btn--ghost lumen-focusable"
                          data-testid={`rule-remove-${i}`}
                          onClick={() => removeRule(r.clientId)}
                        >
                          Remove rule
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="form-builder__btn form-builder__btn--secondary lumen-focusable"
                    data-testid="rule-add"
                    onClick={addRule}
                    disabled={fields.length === 0 || busy}
                  >
                    Add routing rule
                  </button>
                </section>

                {/* D06 — welcome / thank you */}
                <section
                  data-testid="copy-editor-section"
                  aria-labelledby="copy-heading"
                >
                  <h3 id="copy-heading" className="form-builder__heading">
                    Welcome & thank-you
                  </h3>
                  <label className="form-builder__label" htmlFor="welcome-md">
                    Welcome (markdown)
                  </label>
                  <textarea
                    id="welcome-md"
                    className="form-builder__input lumen-focusable"
                    rows={3}
                    value={welcomeMd}
                    onChange={(e) => setWelcomeMd(e.target.value)}
                    data-testid="form-welcome-md"
                  />
                  <label className="form-builder__label" htmlFor="thankyou-md">
                    Thank you (markdown)
                  </label>
                  <textarea
                    id="thankyou-md"
                    className="form-builder__input lumen-focusable"
                    rows={3}
                    value={thankYouMd}
                    onChange={(e) => setThankYouMd(e.target.value)}
                    data-testid="form-thankyou-md"
                  />
                </section>

                {/* D09 — open/close + limit */}
                <section
                  data-testid="limits-editor-section"
                  aria-labelledby="limits-heading"
                >
                  <h3 id="limits-heading" className="form-builder__heading">
                    Open / close & submission limit
                  </h3>
                  <label className="form-builder__label" htmlFor="opens-at">
                    Opens at (ISO-8601)
                  </label>
                  <input
                    id="opens-at"
                    className="form-builder__input lumen-focusable"
                    value={opensAt}
                    onChange={(e) => setOpensAt(e.target.value)}
                    placeholder="2026-01-01T00:00:00.000Z"
                    data-testid="form-opens-at"
                  />
                  <label className="form-builder__label" htmlFor="closes-at">
                    Closes at (ISO-8601)
                  </label>
                  <input
                    id="closes-at"
                    className="form-builder__input lumen-focusable"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                    placeholder="2026-12-31T23:59:59.000Z"
                    data-testid="form-closes-at"
                  />
                  <label
                    className="form-builder__label"
                    htmlFor="submission-limit"
                  >
                    Submission limit
                  </label>
                  <input
                    id="submission-limit"
                    type="number"
                    min={1}
                    className="form-builder__input lumen-focusable"
                    value={submissionLimit}
                    onChange={(e) => setSubmissionLimit(e.target.value)}
                    data-testid="form-submission-limit"
                  />
                </section>
              </div>
            ) : null}
          </div>

          {/* Status strip — primary actions live in PageHeader (same inventory testids) */}
          <section
            className="form-builder__card form-builder__actions"
            data-testid="form-actions"
          >
            {!publishEnabled ? (
              <p
                className="form-builder__status form-builder__status--warn"
                data-testid="form-publish-blocked"
                role="status"
              >
                {reasonMessage(blockReasons)}
              </p>
            ) : null}
            {saveStatus ? (
              <p
                className={`form-builder__status form-builder__status--${saveStatus.kind}`}
                data-testid="form-save-status"
                role="status"
              >
                {saveStatus.text}
              </p>
            ) : null}
            {publishStatus ? (
              <p
                className={`form-builder__status form-builder__status--${publishStatus.kind}`}
                data-testid="form-publish-status"
                role="status"
              >
                {publishStatus.text}
              </p>
            ) : null}
            {linkStatus ? (
              <p
                className={`form-builder__status form-builder__status--${linkStatus.kind}`}
                data-testid="form-link-status"
                role="status"
              >
                {linkStatus.text}
              </p>
            ) : null}
            {eventSlug ? (
              <p className="form-builder__meta" data-testid="form-public-path">
                Public path:{" "}
                <code data-testid="form-public-href">/cfp/{eventSlug}</code>
              </p>
            ) : null}
            {draftMeta ? (
              <p className="form-builder__meta" data-testid="form-draft-meta">
                Draft version id <code>{draftMeta.id}</code>
                {draftMeta.fields.length > 0
                  ? ` · ${draftMeta.fields.length} server fields`
                  : ""}
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <p className="form-builder__empty" data-testid="form-builder-empty">
          Create a form to open the builder (outline, canvas, inspector, publish).
        </p>
      )}
    </div>
  );
}
