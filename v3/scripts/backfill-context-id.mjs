/**
 * One-off backfill: label every task missing `contextId`.
 *   contextId = missionId ?? "board"
 * Run BEFORE shipping Task 8 (board-orchestrator context scoping), otherwise the
 * board orchestrator (scoped to "board") would not see its existing tasks.
 *
 * Usage (from v3/):
 *   DRY:   node scripts/backfill-context-id.mjs           # logs only, no writes
 *   APPLY: node scripts/backfill-context-id.mjs --apply
 *
 * Requires the same Firebase env the app uses (FIREBASE_* / VITE_FIREBASE_*).
 */
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";
import { pathToFileURL } from "url";

const APPLY = process.argv.includes("--apply");

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
  authDomain:
    process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID,
};

// Copy of computeContextIdBackfill from electron/mcp-server/context.ts.
// This standalone .mjs cannot import the TS source (or its built dist-mcp/
// artifact) without coupling the script to a build step, so the logic is
// duplicated here but exported — tests/unit/context.test.ts imports both
// implementations and asserts parity, so drift fails CI instead of silently.
export function computeContextIdBackfill(tasks) {
  return tasks
    .filter((t) => !t.contextId)
    .map((t) => ({ id: t.id, contextId: t.missionId ?? "board" }));
}

async function main() {
  if (!firebaseConfig.projectId) {
    throw new Error(
      "Missing Firebase env (FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID).",
    );
  }
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const snap = await getDocs(collection(db, "tasks"));
  const tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const updates = computeContextIdBackfill(tasks);

  console.log(`Total tasks: ${tasks.length}, need backfill: ${updates.length}`);
  for (const u of updates) {
    console.log(`  ${u.id} → contextId=${u.contextId}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no writes. Re-run with --apply to commit.");
    return;
  }
  for (const u of updates) {
    await updateDoc(doc(db, "tasks", u.id), { contextId: u.contextId });
  }
  console.log(`\nApplied ${updates.length} updates.`);
}

// Only run the migration when invoked directly (node scripts/backfill-context-id.mjs).
// When imported (e.g. by the parity test) this guard keeps main() from firing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
