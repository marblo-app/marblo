import { type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithCustomToken,
  type Auth,
  type User,
} from 'firebase/auth';

const AUTH_READY_BY_APP = new Map<string, Promise<void>>();
const TOKEN_WAIT_LOG_INTERVAL_MS = 10_000;
const AUTH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const MAX_AUTH_RETRY_DELAY_MS = 30_000;

function isTestMode(): boolean {
  return (
    process.env.MARBLO_TEST_MODE === 'mock' ||
    process.env.MARBLO_TEST_BYPASS_AUTH === '1'
  );
}

function getFirebaseAuthErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}

function describeUser(user: User | null): string {
  if (!user) return 'none';
  return `${user.uid}${user.isAnonymous ? ' (anonymous)' : ''}`;
}

async function waitForCustomToken(label: string): Promise<string> {
  let lastLogAt = 0;

  while (true) {
    const token = process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    if (token) return token;

    const now = Date.now();
    if (now - lastLogAt >= TOKEN_WAIT_LOG_INTERVAL_MS) {
      lastLogAt = now;
      console.warn(
        `[${label}] waiting for MARBLO_FIREBASE_CUSTOM_TOKEN before Firestore access`,
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
}

async function signInNamedAppWithCustomToken(
  auth: Auth,
  label: string,
): Promise<void> {
  const token = await waitForCustomToken(label);
  try {
    const credential = await signInWithCustomToken(auth, token);
    console.log(
      `[${label}] Firebase auth OK uid=${credential.user.uid} anonymous=${credential.user.isAnonymous}`,
    );
  } catch (error) {
    throw new Error(
      `[${label}] custom-token auth failed (code=${getFirebaseAuthErrorCode(
        error,
      )})`,
    );
  }
}

function authRetryDelayMs(attempt: number): number {
  return Math.min(
    AUTH_RETRY_DELAYS_MS[attempt - 1] ?? MAX_AUTH_RETRY_DELAY_MS,
    MAX_AUTH_RETRY_DELAY_MS,
  );
}

async function signInNamedAppWithRetry(
  auth: Auth,
  label: string,
): Promise<void> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      await signInNamedAppWithCustomToken(auth, label);
      return;
    } catch (error) {
      const delayMs = authRetryDelayMs(attempt);
      console.error(
        `[${label}] Firebase auth failed (attempt ${attempt}; retrying in ${delayMs}ms):`,
        error,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function ensureFirebaseCustomTokenAuth(
  app: FirebaseApp,
  label: string,
): Promise<void> {
  const cacheKey = app.name;
  const existing = AUTH_READY_BY_APP.get(cacheKey);
  if (existing) return existing;

  const authReady = (async (): Promise<void> => {
    if (isTestMode()) {
      console.log(`[${label}] Firebase auth skipped in test mode`);
      return;
    }

    const auth = getAuth(app);
    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      console.log(
        `[${label}] Firebase auth already ready uid=${describeUser(
          auth.currentUser,
        )}`,
      );
      return;
    }

    await signInNamedAppWithRetry(auth, label);
  })();

  AUTH_READY_BY_APP.set(cacheKey, authReady);
  return authReady;
}
