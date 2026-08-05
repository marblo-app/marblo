#!/usr/bin/env node
/**
 * betatester50_waitlist 이력 → marketing_contacts 백필.
 *
 * 기본은 dry-run 이며 Firestore/BQ write 를 하지 않는다.
 *   GCLOUD_PROJECT=marblo-2253d npm run backfill:marketing-contacts
 *
 * 실적재는 오케/사장님 승인 후 운영자 ADC 로만 실행한다.
 *   GCLOUD_PROJECT=marblo-2253d npm run backfill:marketing-contacts -- --apply
 *
 * BigQuery 미러는 --apply 성공 후 marblo_marketing.contacts_daily 를 같은 경로로
 * 갱신한다. BQ 갱신만 운영 스케줄에 맡기려면 --skip-bq-mirror 를 붙인다.
 */
import * as admin from "firebase-admin";

import { MARKETING_CONTACTS_COLLECTION } from "../src/marketingContacts";
import {
  mirrorMarketingContactsToBqInternal,
  upsertMarketingContact,
} from "../src/index";
import {
  buildWaitlistBackfillPlan,
  waitlistTargetToUpsertInput,
  type WaitlistBackfillRow,
} from "../src/waitlistMarketingBackfill";

const ARGV = process.argv.slice(2);
const has = (flag: string) => ARGV.includes(flag);
const APPLY = has("--apply");
const DRY_RUN = has("--dry-run") || !APPLY;
const SKIP_BQ_MIRROR = has("--skip-bq-mirror");
const LIMIT_RAW = ARGV.find((a) => a.startsWith("--limit="))?.slice(8);
const LIMIT = LIMIT_RAW ? Number(LIMIT_RAW) : undefined;

if (APPLY && has("--dry-run")) {
  throw new Error("--apply 와 --dry-run 은 함께 사용할 수 없다");
}
if (LIMIT_RAW && (!Number.isFinite(LIMIT) || (LIMIT as number) <= 0)) {
  throw new Error(`--limit 은 양수여야 한다: ${LIMIT_RAW}`);
}

const db = admin.firestore();
const GET_ALL_CHUNK = 300;

function maskEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

async function readWaitlistRows(): Promise<WaitlistBackfillRow[]> {
  let query: admin.firestore.Query = db
    .collection("betatester50_waitlist")
    .orderBy(admin.firestore.FieldPath.documentId());
  if (LIMIT) query = query.limit(LIMIT);
  const snap = await query.get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      docId: doc.id,
      email: data.email,
      locale: data.locale,
      createdAt: data.createdAt,
      marketingConsent: data.marketingConsent,
      marketingConsentVersion: data.marketingConsentVersion,
      marketingConsentAt: data.marketingConsentAt,
    };
  });
}

async function readExistingContactIds(
  contactIds: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < contactIds.length; i += GET_ALL_CHUNK) {
    const chunk = contactIds.slice(i, i + GET_ALL_CHUNK);
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection(MARKETING_CONTACTS_COLLECTION).doc(id)),
    );
    snaps.forEach((snap) => {
      if (snap.exists) existing.add(snap.id);
    });
  }
  return existing;
}

async function main(): Promise<void> {
  const rows = await readWaitlistRows();
  const initialPlan = buildWaitlistBackfillPlan(rows, new Set());
  const existing = await readExistingContactIds(
    initialPlan.targets.map((t) => t.contactId),
  );
  const plan = buildWaitlistBackfillPlan(rows, existing);

  const summary = {
    mode: DRY_RUN ? "dry-run" : "apply",
    waitlistRowsScanned: rows.length,
    targetContacts: plan.targets.length,
    missingContacts: plan.missingContacts,
    existingContactsToAugment: plan.existingContacts,
    grantTargets: plan.grantTargets,
    pendingTargets: plan.pendingTargets,
    duplicateRows: plan.duplicateRows,
    skippedInvalidEmail: plan.skippedInvalidEmail,
    bqMirror: !DRY_RUN && !SKIP_BQ_MIRROR ? "after-apply" : "skipped",
  };
  console.log(JSON.stringify(summary, null, 2));

  for (const target of plan.targets) {
    console.log(
      [
        DRY_RUN ? "DRY-RUN" : "TARGET",
        target.exists ? "augment" : "create",
        target.consentKind,
        target.contactId.slice(0, 12),
        maskEmail(target.normalizedEmail),
        `docs=${target.sourceDocIds.length}`,
      ].join(" "),
    );
  }

  if (DRY_RUN) return;

  const applied = {
    created: 0,
    updated: 0,
    consentGranted: 0,
    consentPending: 0,
  };
  for (const target of plan.targets) {
    const result = await upsertMarketingContact(
      waitlistTargetToUpsertInput(target),
    );
    if (result.created) applied.created++;
    else applied.updated++;
    if (result.consentGranted) applied.consentGranted++;
    if (result.consentPending) applied.consentPending++;
  }

  const out: Record<string, unknown> = { applied };
  if (!SKIP_BQ_MIRROR) {
    out.bqMirror = await mirrorMarketingContactsToBqInternal();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error("[waitlist-marketing-backfill] failed:", err);
  process.exitCode = 1;
});
