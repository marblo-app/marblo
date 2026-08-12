/**
 * Google Drive OAuth 크레덴셜의 **안전 저장소**.
 *
 * ── 왜 별 모듈인가 ────────────────────────────────────────────────────────
 * `github-token-store.ts` 와 같은 자리이고 같은 규율을 따른다. 다만 Drive 는
 * 단일 access_token 이 아니라 **세트**를 보관해야 한다 — refresh_token(장기),
 * access_token + 만료시각(단기 캐시), 실제 부여된 scope(사용자가 동의 화면에서
 * 체크를 뺄 수 있다), 그리고 어느 구글 계정인지(재동의 때 login_hint 로 쓰고
 * UI 가 "누구로 연결됨" 을 보여준다).
 *
 * ── 보안 불변식 ──────────────────────────────────────────────────────────
 * 1. **평문 미저장**: Electron `safeStorage`(macOS Keychain / Windows DPAPI /
 *    Linux libsecret)로만 암호화한다. 암호화가 불가능하면 **쓰지 않고 throw** —
 *    vendor-secrets 와 같은 P0-4 규율(평문 폴백 금지).
 * 2. **평문 미유출**: 토큰 평문을 돌려주는 창구는 `getGoogleDriveTokens` 하나뿐이고
 *    그 호출자는 `google-drive-auth.ts` 다. IPC·UI·로그가 쓰는 창구는
 *    `googleDriveConnectionStatus` 이고 **토큰 값이 없다**(계정 이메일·스코프·
 *    만료시각만).
 * 3. 계정(userId)별로 분리 저장한다 — 한 머신을 여러 Marblo 계정이 쓸 수 있다.
 * 4. 파일 권한 0600.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SafeStorage } from "electron";

const STORE_DIRECTORY = path.join(os.homedir(), ".marblo");
const STORE_FILE = path.join(STORE_DIRECTORY, "google-drive-oauth.enc.json");

/** 저장하는 크레덴셜 세트(평문 형태 — 디스크에는 이걸 통째 암호화해 넣는다). */
export interface GoogleDriveTokens {
  refreshToken: string;
  /** 마지막으로 받아둔 단기 토큰. 없거나 만료면 refresh 로 새로 받는다. */
  accessToken?: string;
  /** accessToken 만료 epoch ms. */
  accessTokenExpiresAt?: number;
  /** 실제 부여된 스코프(공백 구분). */
  scope?: string;
  /** 연결된 구글 계정 이메일(있으면). 재동의 login_hint + UI 표시용. */
  email?: string;
  /** 연결 시각 epoch ms. */
  connectedAt: number;
}

/** 디스크 포맷. `accounts[userId]` 는 **base64 암호문 한 덩어리**다. */
interface EncryptedDriveStore {
  version: 1;
  accounts: Record<string, string>;
}

function readStore(): EncryptedDriveStore {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && "accounts" in parsed) {
      const accounts = (parsed as { accounts?: unknown }).accounts;
      if (
        accounts &&
        typeof accounts === "object" &&
        !Array.isArray(accounts)
      ) {
        return {
          version: 1,
          accounts: { ...(accounts as Record<string, string>) },
        };
      }
    }
  } catch {
    // A missing or malformed local store is equivalent to no connected Drive.
  }
  return { version: 1, accounts: {} };
}

function writeStore(store: EncryptedDriveStore): void {
  fs.mkdirSync(STORE_DIRECTORY, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    // 기존 파일이 있으면 mode 인자가 무시되므로 명시적으로 좁힌다.
    fs.chmodSync(STORE_FILE, 0o600);
  } catch {
    /* Windows 등에서 실패해도 치명적이지 않다 */
  }
}

function assertSafeStorage(storage: SafeStorage): void {
  if (!storage.isEncryptionAvailable()) {
    throw new Error(
      "OS 키체인을 사용할 수 없어 Google Drive 연결 정보를 저장할 수 없습니다. " +
        "Linux 라면 libsecret-1-0 / gnome-keyring 설치 후 Marblo 를 재시작하세요.",
    );
  }
}

/** 저장된 크레덴셜 평문. **유일한 평문 반환 창구**. 없거나 못 읽으면 null. */
export function getGoogleDriveTokens(
  storage: SafeStorage,
  userId: string,
): GoogleDriveTokens | null {
  try {
    assertSafeStorage(storage);
    const encrypted = readStore().accounts[userId];
    if (!encrypted) return null;
    const plain = storage.decryptString(Buffer.from(encrypted, "base64"));
    const parsed: unknown = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object") return null;
    const tokens = parsed as Partial<GoogleDriveTokens>;
    if (typeof tokens.refreshToken !== "string" || !tokens.refreshToken) {
      return null;
    }
    return {
      refreshToken: tokens.refreshToken,
      accessToken:
        typeof tokens.accessToken === "string" ? tokens.accessToken : undefined,
      accessTokenExpiresAt:
        typeof tokens.accessTokenExpiresAt === "number"
          ? tokens.accessTokenExpiresAt
          : undefined,
      scope: typeof tokens.scope === "string" ? tokens.scope : undefined,
      email: typeof tokens.email === "string" ? tokens.email : undefined,
      connectedAt:
        typeof tokens.connectedAt === "number" ? tokens.connectedAt : 0,
    };
  } catch {
    // 다른 머신/다른 OS 계정에서 만든 항목은 복호화가 실패한다 → 미연결 취급.
    return null;
  }
}

export function saveGoogleDriveTokens(
  storage: SafeStorage,
  userId: string,
  tokens: GoogleDriveTokens,
): void {
  assertSafeStorage(storage);
  const store = readStore();
  store.accounts[userId] = storage
    .encryptString(JSON.stringify(tokens))
    .toString("base64");
  writeStore(store);
}

/**
 * 삭제(멱등). ★`storage` 를 받지만 쓰지 않는다 — 형제 저장소들과 호출 형태를
 * 맞추기 위해 남긴 인자다. 삭제에 복호화가 필요 없고, 오히려 키체인을 못 열 때
 * 연결 해제까지 막히면 사용자가 잘못된 자격증명에 갇힌다.
 */
export function removeGoogleDriveTokens(
  _storage: SafeStorage,
  userId: string,
): void {
  const store = readStore();
  if (!(userId in store.accounts)) return; // 멱등 — 지울 게 없으면 키체인도 안 건드린다
  delete store.accounts[userId];
  writeStore(store);
}

/** UI·IPC·로그가 쓰는 **토큰 값 없는** 연결 상태. */
export interface GoogleDriveConnectionStatus {
  connected: boolean;
  /** 연결된 구글 계정 이메일(알 수 있으면). */
  email?: string;
  /** 실제 부여된 스코프 목록. */
  scopes?: string[];
  connectedAt?: number;
}

export function googleDriveConnectionStatus(
  storage: SafeStorage,
  userId: string,
): GoogleDriveConnectionStatus {
  const tokens = getGoogleDriveTokens(storage, userId);
  if (!tokens) return { connected: false };
  return {
    connected: true,
    email: tokens.email,
    scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [],
    connectedAt: tokens.connectedAt || undefined,
  };
}
