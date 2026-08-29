#!/usr/bin/env node
/**
 * Backfill `memberRoles/{projectId}_{uid}` for members who have no role doc.
 *
 * WHY (ticket uhkQrRBgeBRddWb6OeDa, P1):
 *   Invitation acceptance used to drop `invitation.role` on the floor — it only
 *   ran `addMember()`. Accepted members therefore ended up with NO role doc, and
 *   both the server (`normalizeMemberRole`) and `firestore.rules`
 *   (`getMemberRole`) fold a missing doc to `member`, which grants repository
 *   **write**. So a user invited as `viewer` silently received push access.
 *   The leak itself is closed in teamService.acceptInvitation + firestore.rules.
 *   This script makes the *existing* implicit roles explicit so the default can
 *   later be flipped to `viewer` without stripping anyone's access.
 *
 * SAFETY MODEL:
 *   - Dry run is the default. Writes require BOTH --apply and --confirm=<token>.
 *   - Default mode is `preserve`: every backfilled doc gets role="member", which
 *     is exactly the role these users already have in effect today. Nobody gains
 *     or loses a permission. This is the mode to run first.
 *   - `--mode=invitation` instead restores the role the inviter actually chose,
 *     read from the `invitations` doc. This CAN DEMOTE people (viewer invites
 *     that leaked into member) — that is the point, but it is a live permission
 *     change and needs explicit approval per project.
 *   - Owners are always skipped: owner comes from `projects.ownerId`, never from
 *     a role doc (server `resolveProjectRole`, rules `isProjectOwner`).
 *   - Never writes role="owner" and never touches an existing doc.
 *
 * Dry run (default, no writes) — all projects:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/backfill-member-roles.mjs
 *
 * Dry run scoped to one project, showing what the invitations say:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/backfill-member-roles.mjs \
 *     --project=GFB8JnJrrX6AgahqmGB3 --mode=invitation
 *
 * Apply after explicit approval:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/backfill-member-roles.mjs \
 *     --apply --confirm=backfill-member-roles
 *
 * Revoke plan (dry run) / revoke — deletes ONLY docs this script created,
 * identified by the `backfillOperation` marker field:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/backfill-member-roles.mjs --revert
 *   GCLOUD_PROJECT=marblo-2253d node scripts/backfill-member-roles.mjs \
 *     --revert --apply --confirm=revert-backfill-member-roles
 *
 * Auth: ADC OAuth + Firestore REST, same shape as
 * grant-owner-team-collab-test.mjs. No secrets are printed.
 */
import { execFileSync } from "node:child_process";

const OPERATION = "backfill_member_roles";
const APPLY_CONFIRM = "backfill-member-roles";
const REVERT_CONFIRM = "revert-backfill-member-roles";

/**
 * The role a missing doc currently resolves to, in BOTH the server
 * (`normalizeMemberRole`) and `firestore.rules` (`getMemberRole`).
 * `preserve` mode writes exactly this, so effective permissions do not move.
 */
const IMPLICIT_ROLE = "member";

/** Roles that may live in a role doc. `owner` is deliberately absent. */
const STORABLE_ROLES = new Set(["admin", "member", "viewer"]);

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const argValue = (flag) => {
  const hit = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : "";
};
const CONFIRM = argValue("--confirm");
const PROJECT_FILTER = argValue("--project");
const MODE = argValue("--mode") || "preserve";
const LIMIT = Number(argValue("--limit") || "0") || 0;

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";

function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }
  return execFileSync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

let token = "";

function firestoreUrl(documentPath = "") {
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;
  return documentPath ? `${base}/${documentPath}` : base;
}

function firestoreCommitUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:commit`;
}

function firestoreRunQueryUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:runQuery`;
}

function documentName(collection, id) {
  return `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${collection}/${id}`;
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": PROJECT_ID,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`${res.status} ${res.statusText}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function fromFirestoreValue(value) {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, child]) => [
        key,
        fromFirestoreValue(child),
      ]),
    );
  }
  return undefined;
}

function toFirestoreValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .map(([key, child]) => [key, toFirestoreValue(child)])
            .filter(([, child]) => child !== undefined),
        ),
      },
    };
  }
  return undefined;
}

function documentData(doc) {
  return Object.fromEntries(
    Object.entries(doc?.fields || {}).map(([key, value]) => [
      key,
      fromFirestoreValue(value),
    ]),
  );
}

function docId(name) {
  return String(name || "")
    .split("/")
    .at(-1);
}

/** All docs of a top-level collection, via runQuery paging on __name__. */
async function listCollection(collectionId) {
  const out = [];
  let cursor = null;
  for (;;) {
    const structuredQuery = {
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: 300,
    };
    if (cursor) {
      structuredQuery.startAt = {
        values: [{ referenceValue: cursor }],
        before: false,
      };
    }
    const rows = await fetchJson(firestoreRunQueryUrl(), {
      method: "POST",
      body: JSON.stringify({ structuredQuery }),
    });
    const docs = rows.map((r) => r.document).filter(Boolean);
    if (docs.length === 0) break;
    out.push(...docs);
    cursor = docs.at(-1).name;
    if (docs.length < 300) break;
  }
  return out;
}

/**
 * memberRoles keyed by `{projectId}_{uid}`. Read the whole collection once —
 * it is small (one doc per explicitly-roled member) and this avoids N gets.
 */
async function loadMemberRoleIndex() {
  const docs = await listCollection("memberRoles");
  const index = new Map();
  for (const doc of docs) {
    index.set(docId(doc.name), documentData(doc));
  }
  return index;
}

/** invitations keyed by projectId -> lowercase email -> data. */
async function loadInvitationIndex() {
  const docs = await listCollection("invitations");
  const index = new Map();
  for (const doc of docs) {
    const data = documentData(doc);
    const projectId = typeof data.projectId === "string" ? data.projectId : "";
    const email =
      typeof data.invitedEmail === "string"
        ? data.invitedEmail.trim().toLowerCase()
        : "";
    if (!projectId || !email) continue;
    if (!index.has(projectId)) index.set(projectId, new Map());
    index.get(projectId).set(email, data);
  }
  return index;
}

/** uid -> lowercase email, from the `users` collection. */
async function loadUserEmailIndex() {
  const docs = await listCollection("users");
  const index = new Map();
  for (const doc of docs) {
    const data = documentData(doc);
    const email =
      typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (email) index.set(docId(doc.name), email);
  }
  return index;
}

/**
 * Mirror of `teamService.memberRoleFromInvitation` and the server's
 * `normalizeMemberRole`: unknown values and 'owner' fold to 'member'.
 * 'owner' never lives in a role doc — it comes from `projects.ownerId`.
 */
function normalizeStorableRole(raw) {
  if (typeof raw !== "string") return IMPLICIT_ROLE;
  const t = raw.trim().toLowerCase();
  return STORABLE_ROLES.has(t) ? t : IMPLICIT_ROLE;
}

/**
 * One member's verdict. Pure — this is the part worth reading in a dry run.
 *
 * @returns {{action: string, reason: string, before: unknown, after: string|null,
 *            invitationRole: string|null, source: string}}
 */
export function classifyMember(input) {
  const { uid, ownerId, existingRole, invitation, mode } = input;

  if (uid === ownerId) {
    return {
      action: "skip",
      reason: "owner_from_ownerId",
      before: existingRole ?? null,
      after: null,
      invitationRole: null,
      source: "ownerId",
    };
  }

  if (existingRole !== undefined && existingRole !== null) {
    return {
      action: "skip",
      reason: "role_doc_exists",
      before: existingRole,
      after: null,
      invitationRole: invitation
        ? normalizeStorableRole(invitation.role)
        : null,
      source: "existing",
    };
  }

  const invitationRole = invitation
    ? normalizeStorableRole(invitation.role)
    : null;

  if (mode === "invitation") {
    if (invitationRole === null) {
      // No invitation found (owner-added, legacy, or deleted invite). Falling
      // back to the implicit role keeps this member's access exactly as it is.
      return {
        action: "create",
        reason: "no_invitation_fallback_implicit",
        before: null,
        after: IMPLICIT_ROLE,
        invitationRole: null,
        source: "implicit",
      };
    }
    return {
      action: "create",
      reason:
        invitationRole === IMPLICIT_ROLE
          ? "invitation_matches_implicit"
          : "invitation_differs_from_implicit",
      before: null,
      after: invitationRole,
      invitationRole,
      source: "invitation",
    };
  }

  return {
    action: "create",
    reason: "preserve_implicit_role",
    before: null,
    after: IMPLICIT_ROLE,
    invitationRole,
    source: "implicit",
  };
}

function buildCreateWrite(projectId, uid, role, now) {
  const id = `${projectId}_${uid}`;
  const payload = {
    projectId,
    userId: uid,
    role,
    // Marker so --revert can delete exactly what this script created and
    // nothing else. A doc written by the app/UI has no such field.
    backfillOperation: OPERATION,
    backfilledAt: now,
  };
  const fields = Object.fromEntries(
    Object.entries(payload)
      .map(([key, value]) => [key, toFirestoreValue(value)])
      .filter(([, value]) => value !== undefined),
  );
  return {
    update: { name: documentName("memberRoles", id), fields },
    updateMask: { fieldPaths: Object.keys(fields) },
    // Refuse to clobber a doc that appeared between the read and the write.
    currentDocument: { exists: false },
  };
}

function buildDeleteWrite(id) {
  return { delete: documentName("memberRoles", id) };
}

async function commitWrites(writes) {
  for (let i = 0; i < writes.length; i += 200) {
    await fetchJson(firestoreCommitUrl(), {
      method: "POST",
      body: JSON.stringify({ writes: writes.slice(i, i + 200) }),
    });
  }
}

/** uid/email are PII-ish; show enough to identify, not enough to harvest. */
function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "(unknown)";
  const [local, domain] = email.split("@");
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

async function planBackfill() {
  const [projects, roleIndex, invitationIndex, userEmails] = await Promise.all([
    listCollection("projects"),
    loadMemberRoleIndex(),
    MODE === "invitation" ? loadInvitationIndex() : Promise.resolve(new Map()),
    MODE === "invitation" ? loadUserEmailIndex() : Promise.resolve(new Map()),
  ]);

  const rows = [];
  for (const projectDoc of projects) {
    const projectId = docId(projectDoc.name);
    if (PROJECT_FILTER && projectId !== PROJECT_FILTER) continue;

    const data = documentData(projectDoc);
    const ownerId = typeof data.ownerId === "string" ? data.ownerId : null;
    const members = Array.isArray(data.members) ? data.members : [];

    for (const uid of members) {
      if (typeof uid !== "string" || !uid) continue;
      const existing = roleIndex.get(`${projectId}_${uid}`);
      const email = userEmails.get(uid) || null;
      const invitation =
        email && invitationIndex.get(projectId)
          ? invitationIndex.get(projectId).get(email)
          : null;

      const verdict = classifyMember({
        uid,
        ownerId,
        existingRole: existing ? existing.role : undefined,
        invitation: invitation || null,
        mode: MODE,
      });

      rows.push({
        projectId,
        projectName: typeof data.name === "string" ? data.name : null,
        uid,
        email: email ? maskEmail(email) : null,
        ...verdict,
      });
    }
  }

  const creates = rows.filter((r) => r.action === "create");
  return { rows, creates: LIMIT > 0 ? creates.slice(0, LIMIT) : creates };
}

async function planRevert() {
  const docs = await listCollection("memberRoles");
  const rows = [];
  for (const doc of docs) {
    const data = documentData(doc);
    if (data.backfillOperation !== OPERATION) continue;
    const id = docId(doc.name);
    if (PROJECT_FILTER && data.projectId !== PROJECT_FILTER) continue;
    rows.push({
      id,
      projectId: data.projectId ?? null,
      uid: data.userId ?? null,
      before: data.role ?? null,
      after: null,
      action: "delete",
      reason: "revert_backfill",
    });
  }
  return { rows, creates: LIMIT > 0 ? rows.slice(0, LIMIT) : rows };
}

function printPlan(title, rows) {
  console.log(`\n=== ${title} ===`);
  console.log(
    `project=${PROJECT_ID} database=${DATABASE_ID} mode=${MODE} ` +
      `filter=${PROJECT_FILTER || "(all projects)"}`,
  );
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  for (const row of rows) {
    const before = row.before === null ? "(no role doc)" : String(row.before);
    const after = row.after === null ? "(unchanged)" : String(row.after);
    const invite =
      row.invitationRole === null || row.invitationRole === undefined
        ? "-"
        : row.invitationRole;
    console.log(
      `  [${row.action}] project=${row.projectId} uid=${row.uid} ` +
        `email=${row.email ?? "-"} before=${before} -> after=${after} ` +
        `invitation=${invite} reason=${row.reason}`,
    );
  }
  const byAction = rows.reduce((acc, row) => {
    acc[row.action] = (acc[row.action] || 0) + 1;
    return acc;
  }, {});
  console.log(`  summary: ${JSON.stringify(byAction)}`);
}

async function main() {
  if (!PROJECT_ID) {
    throw new Error(
      "Missing project id. Set GCLOUD_PROJECT=marblo-2253d before running.",
    );
  }
  if (MODE !== "preserve" && MODE !== "invitation") {
    throw new Error("--mode must be 'preserve' or 'invitation'.");
  }
  if (APPLY && CONFIRM !== (REVERT ? REVERT_CONFIRM : APPLY_CONFIRM)) {
    throw new Error(
      `Refusing to write without --confirm=${
        REVERT ? REVERT_CONFIRM : APPLY_CONFIRM
      }.`,
    );
  }

  token = getAccessToken();
  const now = new Date();

  if (REVERT) {
    const { rows, creates } = await planRevert();
    printPlan("REVERT PLAN (delete backfilled role docs)", rows);
    if (!APPLY) {
      console.log(
        `\nDRY RUN - no writes. Add --apply --confirm=${REVERT_CONFIRM} after approval.`,
      );
      return;
    }
    await commitWrites(creates.map((row) => buildDeleteWrite(row.id)));
    console.log(`\nAPPLIED: deleted ${creates.length} backfilled role doc(s).`);
    return;
  }

  const { rows, creates } = await planBackfill();
  printPlan("BACKFILL PLAN (memberRoles)", rows);

  if (MODE === "invitation") {
    const demotions = creates.filter(
      (r) => r.reason === "invitation_differs_from_implicit",
    );
    if (demotions.length > 0) {
      console.log(
        `\n★ ${demotions.length} member(s) would get a role DIFFERENT from the ` +
          `implicit '${IMPLICIT_ROLE}'. This is a live permission change ` +
          `(a 'viewer' row here loses repository push). Approve per project.`,
      );
    }
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN - no writes. Add --apply --confirm=${APPLY_CONFIRM} after approval.`,
    );
    console.log(
      `Revert path: node scripts/backfill-member-roles.mjs --revert ` +
        `(then --apply --confirm=${REVERT_CONFIRM}).`,
    );
    return;
  }

  await commitWrites(
    creates.map((row) =>
      buildCreateWrite(row.projectId, row.uid, row.after, now),
    ),
  );
  console.log(`\nAPPLIED: created ${creates.length} role doc(s).`);
  console.log(
    `Revert with: node scripts/backfill-member-roles.mjs --revert --apply ` +
      `--confirm=${REVERT_CONFIRM}`,
  );
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("backfill-member-roles.mjs");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { IMPLICIT_ROLE, normalizeStorableRole, OPERATION };
