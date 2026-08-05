import { initializeApp as initializeClientApp } from "firebase/app";
import {
  addDoc,
  collection,
  getFirestore as getClientFirestore,
  serverTimestamp,
} from "firebase/firestore";
import {
  cert,
  deleteApp,
  getApps,
  initializeApp as initializeAdminApp,
  applicationDefault,
} from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

const COLLECTION = "betatester50_waitlist";
const SMOKE_EMAIL_DOMAIN = "marblo-monitor.invalid";
const SMOKE_SOURCE = "home";

type SmokeMode = "normal" | "rehearse-alert";

interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

interface WaitlistPayload {
  email: string;
  locale: "ko";
  source: typeof SMOKE_SOURCE;
  agreed: true;
  agreedAt: ReturnType<typeof serverTimestamp>;
  createdAt: ReturnType<typeof serverTimestamp>;
  marketingConsent: false;
  marketingConsentVersion: null;
  marketingConsentAt: null;
}

interface AlertInput {
  title: string;
  message: string;
  level: "warning" | "error";
  mode: SmokeMode;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function firebaseClientConfig(): FirebaseClientConfig {
  return {
    apiKey: requiredEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: requiredEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: requiredEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    storageBucket: requiredEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requiredEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requiredEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };
}

function makeSmokeEmail(ts: number): string {
  return `smoke+${ts}@${SMOKE_EMAIL_DOMAIN}`;
}

function validPayload(email: string): WaitlistPayload {
  return {
    email,
    locale: "ko",
    source: SMOKE_SOURCE,
    agreed: true,
    agreedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    marketingConsent: false,
    marketingConsentVersion: null,
    marketingConsentAt: null,
  };
}

function invalidPayload(email: string): Record<string, unknown> {
  return {
    ...validPayload(email),
    source: "invalid_source_for_rehearsal",
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function errorCode(err: unknown): string | null {
  if (typeof err !== "object" || err == null) return null;
  const maybe = err as { code?: unknown };
  return typeof maybe.code === "string" ? maybe.code : null;
}

function sentryEndpoint(dsn: string): { url: string; auth: string } {
  const parsed = new URL(dsn);
  const publicKey = parsed.username;
  const projectId = parsed.pathname.replace("/", "");
  if (!publicKey || !projectId) {
    throw new Error("SENTRY_DSN is not a valid Sentry DSN");
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  return {
    url: `${origin}/api/${projectId}/store/`,
    auth:
      `Sentry sentry_version=7, sentry_client=marblo-waitlist-smoke/1.0, ` +
      `sentry_key=${publicKey}`,
  };
}

async function notifyTelegram(input: AlertInput): Promise<void> {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const chatId = optionalEnv("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `[Marblo waitlist smoke] ${input.title}\n${input.message}`,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram alert failed with HTTP ${res.status}`);
  }
}

async function notifySentry(input: AlertInput): Promise<void> {
  const dsn = optionalEnv("SENTRY_DSN");
  if (!dsn) return;

  const endpoint = sentryEndpoint(dsn);
  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sentry-auth": endpoint.auth,
    },
    body: JSON.stringify({
      event_id: crypto.randomUUID().replace(/-/g, ""),
      platform: "node",
      level: input.level,
      logger: "waitlist-public-smoke",
      message: input.title,
      environment: process.env.SENTRY_ENVIRONMENT || "production",
      tags: {
        mode: input.mode,
        source: "github-actions",
        collection: COLLECTION,
      },
      extra: {
        detail: input.message,
      },
      timestamp: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`Sentry alert failed with HTTP ${res.status}`);
  }
}

async function notify(input: AlertInput): Promise<void> {
  const hasTelegram =
    optionalEnv("TELEGRAM_BOT_TOKEN") != null &&
    optionalEnv("TELEGRAM_CHAT_ID") != null;
  const hasSentry = optionalEnv("SENTRY_DSN") != null;
  if (!hasTelegram && !hasSentry) {
    throw new Error("No alert sink configured; set Telegram or Sentry secrets");
  }

  const outcomes = await Promise.allSettled([
    notifyTelegram(input),
    notifySentry(input),
  ]);
  const failed = outcomes
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => errorMessage(result.reason));
  if (failed.length > 0) {
    throw new Error(`Alert delivery failed: ${failed.join("; ")}`);
  }
}

function initAdminApp(): ReturnType<typeof initializeAdminApp> {
  if (getApps().length > 0) return getApps()[0];

  const rawJson = optionalEnv("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (rawJson) {
    return initializeAdminApp({
      credential: cert(JSON.parse(rawJson) as Record<string, string>),
    });
  }
  return initializeAdminApp({ credential: applicationDefault() });
}

async function deleteSmokeDoc(docPath: string): Promise<void> {
  const adminApp = initAdminApp();
  await getAdminFirestore(adminApp).doc(docPath).delete();
  await deleteApp(adminApp);
}

async function run(): Promise<void> {
  const mode: SmokeMode =
    process.argv.includes("--rehearse-alert") ||
    process.env.WAITLIST_SMOKE_REHEARSE_ALERT === "1"
      ? "rehearse-alert"
      : "normal";
  const email = makeSmokeEmail(Date.now());
  const clientApp = initializeClientApp(firebaseClientConfig(), "waitlist-smoke");
  const db = getClientFirestore(clientApp);

  if (mode === "rehearse-alert") {
    try {
      const docRef = await addDoc(
        collection(db, COLLECTION),
        invalidPayload(email),
      );
      await deleteSmokeDoc(docRef.path);
      throw new Error("Rehearsal invalid payload unexpectedly succeeded");
    } catch (err) {
      const code = errorCode(err);
      if (code === "permission-denied") {
        await notify({
          title: "REHEARSAL alert: waitlist rules rejected invalid payload",
          message:
            "Intentional invalid client SDK addDoc was denied by production rules. " +
            `email_domain=${SMOKE_EMAIL_DOMAIN} code=${code}`,
          level: "warning",
          mode,
        });
        console.info("waitlist smoke rehearsal alert sent");
        return;
      }
      throw err;
    }
  }

  let docPath: string | null = null;
  try {
    const docRef = await addDoc(collection(db, COLLECTION), validPayload(email));
    docPath = docRef.path;
    await deleteSmokeDoc(docPath);
    console.info("waitlist public smoke succeeded and synthetic doc was deleted");
  } catch (err) {
    if (docPath) {
      try {
        await deleteSmokeDoc(docPath);
      } catch {
        // The alert below is more important than masking the original failure.
      }
    }
    await notify({
      title: "FAILED: public waitlist client SDK smoke",
      message:
        `Client SDK addDoc/cleanup failed for ${COLLECTION}. ` +
        `email_domain=${SMOKE_EMAIL_DOMAIN} code=${errorCode(err) ?? "unknown"} ` +
        `error=${errorMessage(err)}`,
      level: "error",
      mode,
    });
    throw err;
  }
}

run().catch((err) => {
  console.error(errorMessage(err));
  process.exitCode = 1;
});
