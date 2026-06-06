/**
 * One-off backfill: re-attribute historical Claude per-agent token usage.
 *
 * Why: before the deterministic --session-id fix (task c79d9ced), spawned
 * Claude agents wrote their session JSONLs UNLABELED into per-cwd dirs
 * (~/.claude/projects/<encoded cwd>/). The agents run in v3/ and in worktrees,
 * so their sessions never got mapped to an agentId and the Usage tab shows them
 * at ~0 — even though they did real work (v3 ~59M + worktree ~17M tokens).
 *
 * This script maps each CURRENTLY-ACTIVE marblo Claude agent to its session,
 * re-parses the true token totals from the JSONL, and SETs the agent doc's
 * rolling totals (idempotent — SET, not increment). The session→agentId map was
 * derived by matching each agent process's start time to its session's first
 * event time (sub-second alignment) + cwd, cross-checked against the per-agent
 * MCP-config birth time. Finished agents whose MCP config was already cleaned
 * up (e.g. session 1f0c21b8, ~40M) can't be mapped to an agentId and are NOT
 * touched here — reported as orphans.
 *
 * Usage (from v3/):
 *   DRY:   node scripts/backfill-claude-usage.mjs
 *   APPLY: node scripts/backfill-claude-usage.mjs --apply
 *
 * Reads Firebase config from v3/.env (VITE_FIREBASE_* / FIREBASE_*).
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, updateDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const APPLY = process.argv.includes("--apply");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load v3/.env into process.env (minimal parser) ──────────────────────────
function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain:
    process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId:
    process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
};

// ── Claude session dirs (encoded cwd → ~/.claude/projects/<encoded>) ─────────
const HOME = os.homedir();
const PROJ = path.join(HOME, ".claude", "projects");
const DIR_V3 = path.join(
  PROJ,
  "-Users-dongwonkim-Documents-programming-marblo-v3",
);
const DIR_WT = path.join(
  PROJ,
  "-Users-dongwonkim--marblo-worktrees-marblo-v3-remaining-v3",
);
const DIR_MAIN = path.join(
  PROJ,
  "-Users-dongwonkim-Documents-programming-marblo",
);

// agentId → session file(s). Derived from process start-time ↔ session
// first-event match (see header). Orchestrator = sum of every session this
// project's marblo-labels.json labels "Orchestrator".
const MAP = [
  {
    agentId: "d6f01ee9-d3cb-4b41-914b-2b33f9774ba7",
    role: "Backend (worktree)",
    sessions: [path.join(DIR_WT, "5ba8ce19-7eca-44df-ba52-984e67e9c742.jsonl")],
  },
  {
    agentId: "3717da75-68b2-4e5d-be27-837c7b51aae3",
    role: "Test (worktree)",
    sessions: [path.join(DIR_WT, "61a9cfb3-cacb-417b-a756-42ef02f1fea3.jsonl")],
  },
  {
    agentId: "81058327-4e9a-478c-8e54-07bcbc032b4a",
    role: "Backend (v3)",
    sessions: [path.join(DIR_V3, "c2719ac1-6200-4de2-a17f-f317ff2d32a5.jsonl")],
  },
  {
    agentId: "a4e135a6-f384-4721-83a5-c3847e3b5c2f",
    role: "Frontend (v3)",
    sessions: [path.join(DIR_V3, "1b05d024-8abd-4380-a3ea-b22f1277b63c.jsonl")],
  },
  {
    agentId: "f85d9318-3952-45d5-adaf-2d3b5abd7175",
    role: "Backend (v3)",
    sessions: [path.join(DIR_V3, "753cb173-3abd-4f0f-9f8a-40fe68712b47.jsonl")],
  },
  {
    agentId: "orchestrator-GFB8JnJrrX6AgahqmGB3",
    role: "Orchestrator",
    orchestratorDir: DIR_MAIN,
  },
];

// ── Token parsing (Claude JSONL message.usage) ──────────────────────────────
function sumSession(file) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  if (!fs.existsSync(file)) return t;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const u = o.message?.usage;
    if (!u) continue;
    t.turns++;
    t.input += u.input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0;
  }
  return t;
}

function orchestratorSessions(dir) {
  let labels = {};
  try {
    labels = JSON.parse(
      fs.readFileSync(path.join(dir, "marblo-labels.json"), "utf-8"),
    );
  } catch {
    return [];
  }
  return Object.entries(labels)
    .filter(([, v]) => v.label === "Orchestrator")
    .map(([id]) => path.join(dir, `${id}.jsonl`));
}

// Notional cost estimate (Claude Opus public per-1M rates). Subscriptions are
// flat, so this is informational only — the Usage tab displays tokens.
function estCost(t) {
  return (
    (t.input * 15 + t.output * 75 + t.cacheRead * 1.5 + t.cacheWrite * 18.75) /
    1_000_000
  );
}

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}K` : `${n}`);

async function main() {
  if (!firebaseConfig.projectId) {
    throw new Error("Missing Firebase env (VITE_FIREBASE_PROJECT_ID).");
  }
  const app = initializeApp(firebaseConfig);
  // MCP server pattern: no Auth context in a standalone process, so sign in
  // anonymously to clear the rules' isAuthenticated() gate on agents/*.
  await signInAnonymously(getAuth(app));
  const db = getFirestore(app);

  console.log(
    `\n=== Claude usage backfill (${
      APPLY ? "APPLY" : "DRY RUN"
    }) — Firebase project ${firebaseConfig.projectId} ===\n`,
  );

  let touched = 0;
  for (const m of MAP) {
    const files = m.orchestratorDir
      ? orchestratorSessions(m.orchestratorDir)
      : m.sessions;
    const tot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    for (const f of files) {
      const s = sumSession(f);
      tot.input += s.input;
      tot.output += s.output;
      tot.cacheRead += s.cacheRead;
      tot.cacheWrite += s.cacheWrite;
      tot.turns += s.turns;
    }
    const total = tot.input + tot.output + tot.cacheRead + tot.cacheWrite;
    const cost = estCost(tot);

    const ref = doc(db, "agents", m.agentId);
    const snap = await getDoc(ref);
    const cur = snap.exists() ? snap.data() : null;
    const curTotal = cur
      ? (cur.totalInputTokens || 0) +
        (cur.totalOutputTokens || 0) +
        (cur.totalCacheReadTokens || 0) +
        (cur.totalCacheWriteTokens || 0)
      : 0;

    console.log(`agent ${m.agentId}  [${m.role}]`);
    console.log(
      `  exists=${snap.exists()} name=${cur?.name ?? "-"} model=${
        cur?.model ?? "-"
      } project=${cur?.projectId ?? "-"} role=${cur?.role ?? "-"}`,
    );
    console.log(
      `  sessions=${files.length} turns=${tot.turns}  current=${fmt(
        curTotal,
      )} → NEW=${fmt(total)}  (in=${fmt(tot.input)} out=${fmt(
        tot.output,
      )} cacheR=${fmt(tot.cacheRead)} cacheW=${fmt(
        tot.cacheWrite,
      )})  ~$${cost.toFixed(2)}`,
    );

    if (!snap.exists()) {
      console.log(`  ⚠ doc missing — SKIP (won't fabricate)\n`);
      continue;
    }
    if (total === 0) {
      console.log(`  (0 tokens — skip)\n`);
      continue;
    }
    if (APPLY) {
      await updateDoc(ref, {
        totalInputTokens: tot.input,
        totalOutputTokens: tot.output,
        totalCacheReadTokens: tot.cacheRead,
        totalCacheWriteTokens: tot.cacheWrite,
        totalCost: cost,
        usageBackfilledAt: Date.now(),
      });
      console.log(`  ✓ updated\n`);
    } else {
      console.log(`  (dry run — no write)\n`);
    }
    touched++;
  }

  console.log(
    APPLY
      ? `Applied backfill to ${touched} agent doc(s).`
      : `DRY RUN — ${touched} agent doc(s) would be updated. Re-run with --apply to commit.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
