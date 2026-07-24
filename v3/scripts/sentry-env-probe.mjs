#!/usr/bin/env node
/**
 * Send ONE synthetic Sentry event with a chosen `environment` tag, by POSTing
 * an envelope straight at the ingest endpoint. No app, no build, no Electron.
 *
 * Purpose: prove an alert rule both ways (v3/docs/SENTRY-RUNBOOK.md §5-4).
 *
 *   node scripts/sentry-env-probe.mjs --env development   # expect: NO mail
 *   node scripts/sentry-env-probe.mjs --env production    # expect: MAIL
 *
 * ★ Both directions matter. A filter that blocks dev noise is only half the
 * job — if it also blocks production, real user crashes page nobody, which is
 * a strictly worse failure than the noise it was meant to stop.
 *
 * The DSN comes from $SENTRY_PROBE_DSN and is NEVER printed: this script logs
 * only the host, the project id, and a masked public key.
 */

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Usage: SENTRY_PROBE_DSN=<dsn> node scripts/sentry-env-probe.mjs [options]",
      "",
      "  --env <name>      environment tag (default: development)",
      "  --release <name>  release tag (default: marblo@probe-manual)",
      "  --message <text>  event message",
      "",
      "Runbook: v3/docs/SENTRY-RUNBOOK.md §5-4",
    ].join("\n"),
  );
  process.exit(0);
}

const dsn = process.env.SENTRY_PROBE_DSN;
if (!dsn) {
  console.error(
    "SENTRY_PROBE_DSN is not set.\n" +
      "  dev  DSN → v3/.env            (VITE_SENTRY_DSN)\n" +
      "  prod DSN → v3/.env.production (VITE_SENTRY_DSN)\n" +
      "Pass it via env so it never lands in shell history or this log.",
  );
  process.exit(1);
}

// DSN shape: https://<publicKey>@<host>/<projectId>
let publicKey, host, projectId;
try {
  const u = new URL(dsn);
  publicKey = u.username;
  host = u.host;
  projectId = u.pathname.replace(/^\//, "");
  if (!publicKey || !projectId) throw new Error("missing key or project id");
} catch (err) {
  console.error(`SENTRY_PROBE_DSN is not a valid DSN: ${err.message}`);
  process.exit(1);
}

const environment = flag("env", "development");
const release = flag("release", "marblo@probe-manual");
const message = flag(
  "message",
  `sentry-env-probe: synthetic ${environment} event`,
);

if (environment === "production") {
  console.warn(
    "⚠️  environment=production — this SHOULD page whoever is on the alert rule.\n" +
      "    That is the point: it proves the filter does not over-block.\n",
  );
}

const eventId = Buffer.from(
  crypto.getRandomValues(new Uint8Array(16)),
).toString("hex");
const sentAt = new Date().toISOString();
const url = `https://${host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`;

const event = {
  event_id: eventId,
  timestamp: sentAt,
  platform: "node",
  level: "error",
  environment,
  release,
  logger: "sentry-env-probe",
  tags: { probe: "true", source: "sentry-env-probe" },
  exception: {
    values: [{ type: "SentryEnvProbe", value: message }],
  },
};

const envelope =
  `${JSON.stringify({ event_id: eventId, sent_at: sentAt })}\n` +
  `${JSON.stringify({ type: "event" })}\n` +
  `${JSON.stringify(event)}\n`;

// Masked identity only — never the DSN itself.
console.log(
  `→ host=${host} project=${projectId} key=${publicKey.slice(0, 4)}…${publicKey.slice(-2)}`,
);
console.log(`→ environment=${environment} release=${release}`);

let res, body;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: envelope,
  });
  body = await res.text();
} catch (err) {
  // Network/DNS failure — report the host (safe) but never the DSN.
  console.error(`✗ could not reach ${host}: ${err.message}`);
  process.exit(1);
}

if (!res.ok) {
  console.error(`✗ ingest rejected: HTTP ${res.status} ${body.slice(0, 300)}`);
  process.exit(1);
}

console.log(`✓ accepted (HTTP ${res.status}) event_id=${eventId}`);
console.log(
  [
    "",
    "다음 확인:",
    `  1. Sentry Issues 에서 environment:${environment} 필터로 이 이벤트가 보이는가`,
    "     → 보여야 정상. 적재는 모든 환경에서 계속된다(배선 생존 확인 경로).",
    `  2. 메일이 왔는가 — environment=production 이면 와야 하고, 그 외면 오지 않아야 한다.`,
    "",
    "  런북: v3/docs/SENTRY-RUNBOOK.md §5-4",
  ].join("\n"),
);
