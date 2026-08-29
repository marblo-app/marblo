import type { User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { getDocument, mergeDocument, toTimestamp } from "./firestore";
import { addMember, getProjects } from "./projectService";

interface IssueAgentCustomTokenResponse {
  customToken: string;
  uid: string;
}

interface SyncAgentFirebaseAuthOptions {
  forceRefreshIdToken?: boolean;
}

export type UserProfileSyncResult = "created" | "updated" | "unchanged";

const issueAgentCustomToken = httpsCallable<
  Record<string, never>,
  IssueAgentCustomTokenResponse
>(functions, "issueAgentCustomToken");

const SYNC_AGENT_AUTH_RETRY_DELAYS_MS = [0, 500, 1_500];
const USERS_COLLECTION = "users";
const USER_PROFILE_FIELDS = ["email", "displayName", "photoURL"] as const;
const userProfileSyncQueues = new Map<string, Promise<UserProfileSyncResult>>();

type UserProfileField = (typeof USER_PROFILE_FIELDS)[number];
type UserProfileFields = Partial<Record<UserProfileField, string>>;
type UserProfilePatch = UserProfileFields & {
  createdAt?: ReturnType<typeof toTimestamp>;
  updatedAt: ReturnType<typeof toTimestamp>;
};

function getAgentAuthApi() {
  return window.electronAPI?.auth;
}

function isIssueAgentCustomTokenResponse(
  value: unknown,
): value is IssueAgentCustomTokenResponse {
  if (typeof value !== "object" || value === null) return false;

  const response = value as Partial<IssueAgentCustomTokenResponse>;
  return (
    typeof response.customToken === "string" && typeof response.uid === "string"
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function userProfileFields(user: User): UserProfileFields {
  const fields: UserProfileFields = {};
  if (user.email) fields.email = user.email;
  const displayName = user.displayName ?? user.email ?? undefined;
  if (displayName) fields.displayName = displayName;
  if (user.photoURL) fields.photoURL = user.photoURL;
  return fields;
}

function changedProfileFields(
  existing: Record<string, unknown>,
  next: UserProfileFields,
): UserProfileFields {
  const patch: UserProfileFields = {};
  for (const field of USER_PROFILE_FIELDS) {
    const nextValue = next[field];
    if (nextValue !== undefined && existing[field] !== nextValue) {
      patch[field] = nextValue;
    }
  }
  return patch;
}

function userProfilePatch(
  user: User,
  existing: Record<string, unknown> | null,
): UserProfilePatch | null {
  const now = toTimestamp(new Date());
  const fields = userProfileFields(user);

  if (!existing) {
    return {
      ...fields,
      createdAt: now,
      updatedAt: now,
    };
  }

  const changed = changedProfileFields(existing, fields);
  if (Object.keys(changed).length === 0) return null;

  return {
    ...changed,
    updatedAt: now,
  };
}

async function ensureUserProfileOnce(
  user: User,
): Promise<UserProfileSyncResult> {
  const existing = await getDocument<Record<string, unknown>>(
    USERS_COLLECTION,
    user.uid,
  );
  const patch = userProfilePatch(user, existing);
  if (!patch) return "unchanged";

  await mergeDocument(USERS_COLLECTION, user.uid, patch);
  return existing ? "updated" : "created";
}

export async function ensureUserProfile(
  user: User,
): Promise<UserProfileSyncResult> {
  const previous = userProfileSyncQueues.get(user.uid);
  const run = (previous ?? Promise.resolve("unchanged" as UserProfileSyncResult))
    .catch(() => "unchanged" as UserProfileSyncResult)
    .then(() => ensureUserProfileOnce(user));

  userProfileSyncQueues.set(user.uid, run);

  try {
    return await run;
  } finally {
    if (userProfileSyncQueues.get(user.uid) === run) {
      userProfileSyncQueues.delete(user.uid);
    }
  }
}

async function ensureOwnedProjectMembership(user: User): Promise<void> {
  const projects = await getProjects(user.uid);
  await Promise.all(
    projects
      .filter((project) => project.ownerId === user.uid)
      .filter((project) => !project.members.includes(user.uid))
      .map((project) => addMember(project.id, user.uid)),
  );
}

async function syncSignedInUserState(user: User): Promise<void> {
  try {
    await ensureUserProfile(user);
    await ensureOwnedProjectMembership(user);
  } catch (err) {
    console.warn(
      `[auth] signed-in user state sync failed: ${errorMessage(err)}`,
    );
  }
}

async function syncAgentFirebaseAuthOnce(
  user: User,
  options: SyncAgentFirebaseAuthOptions,
): Promise<void> {
  const api = getAgentAuthApi();
  if (!api?.syncAgentCustomToken) return;

  await user.getIdToken(options.forceRefreshIdToken ?? false);
  const result = await issueAgentCustomToken({});
  const { data } = result;

  if (!isIssueAgentCustomTokenResponse(data) || data.uid !== user.uid) {
    throw new Error("Invalid agent custom token response.");
  }

  const syncResult = await api.syncAgentCustomToken(data.customToken);
  if (!syncResult.ok) {
    throw new Error(syncResult.error || "Agent Firebase auth sync failed.");
  }
}

export async function syncAgentFirebaseAuth(
  user: User,
  options: SyncAgentFirebaseAuthOptions = {},
): Promise<void> {
  await syncSignedInUserState(user);

  const api = getAgentAuthApi();
  if (!api?.syncAgentCustomToken) return;

  let lastError: unknown;

  for (let attempt = 1; attempt <= SYNC_AGENT_AUTH_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = SYNC_AGENT_AUTH_RETRY_DELAYS_MS[attempt - 1];
    if (delayMs > 0) await sleep(delayMs);

    try {
      await syncAgentFirebaseAuthOnce(user, options);
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `[auth] agent Firebase auth sync attempt ${attempt} failed: ${errorMessage(
          err,
        )}`,
      );
    }
  }

  await api.clearAgentCustomToken?.().catch(() => undefined);
  throw lastError instanceof Error
    ? lastError
    : new Error("Agent Firebase auth sync failed.");
}

export async function clearAgentFirebaseAuth(): Promise<void> {
  const api = getAgentAuthApi();
  if (!api?.clearAgentCustomToken) return;

  const result = await api.clearAgentCustomToken();
  if (!result.ok) {
    throw new Error(result.error || "Agent Firebase auth clear failed.");
  }
}
