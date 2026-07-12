/**
 * One-off backfill: ensure every project with an ownerId includes that owner
 * uid in project.members.
 *
 * Why: hardened Firestore rules authorize project-scoped writes through
 * `request.auth.uid in project.members`. Legacy projects with ownerId but no
 * members array would block their own owner after the rules deploy.
 *
 * Usage (from v3/):
 *   DRY:   node scripts/backfill-project-members.mjs
 *   APPLY: node scripts/backfill-project-members.mjs --apply
 *
 * Auth: uses Firestore REST with an admin-capable OAuth access token. Provide
 * GOOGLE_OAUTH_ACCESS_TOKEN, or have gcloud ADC/user auth available:
 *   gcloud auth application-default login
 *   gcloud auth login
 */
import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PAGE_SIZE = 300;

function getProjectId() {
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (fromEnv) return fromEnv;

  try {
    const configured = execFileSync(
      "gcloud",
      ["config", "get-value", "project"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return configured || null;
  } catch {
    return null;
  }
}

function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }

  const attempts = [
    ["auth", "application-default", "print-access-token"],
    ["auth", "print-access-token"],
  ];

  for (const args of attempts) {
    try {
      const token = execFileSync("gcloud", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (token) return token;
    } catch {
      // Try the next configured gcloud auth source.
    }
  }

  return null;
}

function stringValue(fields, key) {
  const value = fields?.[key]?.stringValue;
  return typeof value === "string" ? value : null;
}

function stringArrayValue(fields, key) {
  const values = fields?.[key]?.arrayValue?.values;
  if (!Array.isArray(values)) return [];
  return values
    .map((value) =>
      typeof value?.stringValue === "string" ? value.stringValue : null,
    )
    .filter((value) => value !== null);
}

function docId(name) {
  return name.split("/").at(-1) || name;
}

function documentUrl(projectId, documentPath) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents/${documentPath}`;
}

async function fetchJson(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore REST ${res.status} ${res.statusText}: ${body}`);
  }

  return res.json();
}

async function listProjects(projectId, token) {
  const projects = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${documentUrl(projectId, "projects")}?${params.toString()}`;
    const json = await fetchJson(url, token);
    projects.push(...(json.documents || []));
    pageToken = json.nextPageToken || "";
  } while (pageToken);

  return projects;
}

async function patchMembers(projectId, token, project) {
  const now = new Date().toISOString();
  const url = new URL(documentUrl(projectId, `projects/${project.id}`));
  url.searchParams.append("updateMask.fieldPaths", "members");
  url.searchParams.append("updateMask.fieldPaths", "updatedAt");
  url.searchParams.set("currentDocument.exists", "true");

  await fetchJson(url.toString(), token, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        members: {
          arrayValue: {
            values: project.nextMembers.map((member) => ({
              stringValue: member,
            })),
          },
        },
        updatedAt: { timestampValue: now },
      },
    }),
  });
}

function computeBackfill(projectDocs) {
  const skipped = [];
  const updates = [];

  for (const doc of projectDocs) {
    const fields = doc.fields || {};
    const ownerId = stringValue(fields, "ownerId");
    const members = stringArrayValue(fields, "members");
    const id = docId(doc.name);

    if (!ownerId) {
      skipped.push({ id, reason: "missing ownerId" });
      continue;
    }

    if (members.includes(ownerId)) continue;

    updates.push({
      id,
      ownerId,
      currentMembers: members,
      nextMembers: [ownerId, ...members],
    });
  }

  return { skipped, updates };
}

async function main() {
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      "Missing Firebase project id. Set FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID, or configure gcloud project.",
    );
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error(
      "Missing admin OAuth token. Set GOOGLE_OAUTH_ACCESS_TOKEN or run gcloud auth application-default login.",
    );
  }

  const projectDocs = await listProjects(projectId, token);
  const { skipped, updates } = computeBackfill(projectDocs);

  console.log(
    `Projects scanned: ${projectDocs.length}, need backfill: ${updates.length}, skipped: ${skipped.length}`,
  );
  for (const update of updates) {
    console.log(
      `  ${update.id}: add ownerId=${update.ownerId} to members (${update.currentMembers.length} existing)`,
    );
  }
  for (const skip of skipped) {
    console.log(`  skip ${skip.id}: ${skip.reason}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN - no writes. Re-run with --apply to commit.");
    return;
  }

  for (const update of updates) {
    await patchMembers(projectId, token, update);
  }
  console.log(
    `\nApplied project.members backfill to ${updates.length} project(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
