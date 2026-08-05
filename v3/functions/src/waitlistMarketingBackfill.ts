import {
  contactIdForEmail,
  decideWaitlistConsentGrant,
  normalizeMarketingEmail,
  type WaitlistDocRaw,
} from "./marketingContacts";

export interface WaitlistMarketingContactUpsertInput {
  email: string;
  source: "waitlist";
  locale?: string | null;
  signupAt?: Date | null;
  grantConsent?: {
    source: string;
    version: string;
    legalBasis: "explicit_opt_in";
    consentedAt?: unknown | null;
  } | null;
  markPending?: {
    source: string;
    detail: string;
  } | null;
  actor: string;
}

export interface WaitlistBackfillRow {
  docId: string;
  email?: unknown;
  locale?: unknown;
  createdAt?: unknown;
  marketingConsent?: unknown;
  marketingConsentVersion?: unknown;
  marketingConsentAt?: unknown;
}

export interface WaitlistBackfillTarget {
  contactId: string;
  normalizedEmail: string;
  sourceDocIds: string[];
  exists: boolean;
  locale: string | null;
  signupAt: Date | null;
  consentKind: "grant" | "pending";
  grantVersion: string;
  grantConsentedAt: unknown | null;
}

export interface WaitlistBackfillPlan {
  targets: WaitlistBackfillTarget[];
  skippedInvalidEmail: number;
  duplicateRows: number;
  existingContacts: number;
  missingContacts: number;
  grantTargets: number;
  pendingTargets: number;
}

function millisOf(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const ts = v as { toMillis?: () => number; seconds?: number } | null;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return null;
}

function earliestDate(a: Date | null, b: unknown): Date | null {
  const bMs = millisOf(b);
  if (bMs == null) return a;
  if (!a || bMs < a.getTime()) return new Date(bMs);
  return a;
}

function pickLocale(current: string | null, incoming: unknown): string | null {
  if (current) return current;
  return typeof incoming === "string" && incoming.trim()
    ? incoming.trim()
    : null;
}

function waitlistConsentKind(
  row: WaitlistBackfillRow,
): Pick<
  WaitlistBackfillTarget,
  "consentKind" | "grantVersion" | "grantConsentedAt"
> {
  const decision = decideWaitlistConsentGrant(row as WaitlistDocRaw);
  if (decision.kind === "grant") {
    return {
      consentKind: "grant",
      grantVersion: decision.version,
      grantConsentedAt: decision.consentedAt,
    };
  }
  return {
    consentKind: "pending",
    grantVersion: "",
    grantConsentedAt: null,
  };
}

export function buildWaitlistBackfillPlan(
  rows: WaitlistBackfillRow[],
  existingContactIds: ReadonlySet<string>,
): WaitlistBackfillPlan {
  const byContactId = new Map<string, WaitlistBackfillTarget>();
  let skippedInvalidEmail = 0;
  let duplicateRows = 0;

  for (const row of rows) {
    if (typeof row.email !== "string") {
      skippedInvalidEmail++;
      continue;
    }
    const normalizedEmail = normalizeMarketingEmail(row.email);
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      skippedInvalidEmail++;
      continue;
    }

    const contactId = contactIdForEmail(normalizedEmail);
    const consent = waitlistConsentKind(row);
    const existing = byContactId.get(contactId);
    if (!existing) {
      byContactId.set(contactId, {
        contactId,
        normalizedEmail,
        sourceDocIds: [row.docId],
        exists: existingContactIds.has(contactId),
        locale: pickLocale(null, row.locale),
        signupAt: earliestDate(null, row.createdAt),
        ...consent,
      });
      continue;
    }

    duplicateRows++;
    existing.sourceDocIds.push(row.docId);
    existing.locale = pickLocale(existing.locale, row.locale);
    existing.signupAt = earliestDate(existing.signupAt, row.createdAt);
    if (existing.consentKind !== "grant" && consent.consentKind === "grant") {
      existing.consentKind = "grant";
      existing.grantVersion = consent.grantVersion;
      existing.grantConsentedAt = consent.grantConsentedAt;
    }
  }

  const targets = [...byContactId.values()].sort((a, b) =>
    a.contactId.localeCompare(b.contactId),
  );
  return {
    targets,
    skippedInvalidEmail,
    duplicateRows,
    existingContacts: targets.filter((t) => t.exists).length,
    missingContacts: targets.filter((t) => !t.exists).length,
    grantTargets: targets.filter((t) => t.consentKind === "grant").length,
    pendingTargets: targets.filter((t) => t.consentKind === "pending").length,
  };
}

export function waitlistTargetToUpsertInput(
  target: WaitlistBackfillTarget,
): WaitlistMarketingContactUpsertInput {
  return {
    email: target.normalizedEmail,
    source: "waitlist",
    locale: target.locale,
    signupAt: target.signupAt,
    grantConsent:
      target.consentKind === "grant"
        ? {
            source: "waitlist_form_marketing_optin",
            version: target.grantVersion,
            legalBasis: "explicit_opt_in",
            consentedAt: target.grantConsentedAt,
          }
        : null,
    markPending:
      target.consentKind === "pending"
        ? {
            source: "backfill_waitlist",
            detail:
              "waitlist marketingConsent is false/missing; re-consent required",
          }
        : null,
    actor: "backfill:waitlist_marketing_contacts",
  };
}
