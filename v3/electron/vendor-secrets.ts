/**
 * env-swap 벤더(GLM/MiniMax…) 크레덴셜의 **안전 저장소**.
 *
 * ── 왜 별 모듈인가 ────────────────────────────────────────────────────────
 * 레지스트리의 `envProfile` 은 시크릿을 값이 아니라 `${ZAI_API_KEY}` 라는 **env 키
 * 이름**으로만 적는다(model-registry 주석). 그 이름을 실제 값으로 바꾸는 곳은
 * `agent-config.resolveVendorEnvProfile` 한 군데뿐인데, 종전엔 그 값이 오직
 * `process.env`(= 부팅 때 dotenv 로 읽은 `v3/.env`)에서만 왔다. 그래서 Finder 로
 * 띄운 **패키지앱엔 키를 넣을 방법이 아예 없었다** — 셸 env 가 없고 앱 번들 안의
 * `.env` 를 사용자가 편집할 수도 없다. 이 모듈이 그 두 번째 소스다.
 *
 * ── 보안 불변식 ──────────────────────────────────────────────────────────
 * 1. **평문 미저장**: Electron `safeStorage`(macOS Keychain / Windows DPAPI /
 *    Linux libsecret)로만 암호화해 쓴다. 암호화가 불가능하면 **쓰지 않고 throw**
 *    한다 — BYOK 저장소(main.ts writeVendorSecrets 형제)와 같은 P0-4 규율이다.
 * 2. **평문 미유출**: 이 모듈에서 평문을 돌려주는 함수는 `getVendorSecret` 하나뿐이고,
 *    그 호출자는 스폰 env 를 조립하는 `resolveVendorEnvProfile` 뿐이다. IPC·UI·로그가
 *    쓰는 창구(`vendorSecretStatus`)는 **마스킹된 미리보기**만 담는다.
 * 3. **키 이름 allowlist**: 저장 가능한 env 키는 레지스트리가 실제로 `${...}` 로
 *    참조하는 이름뿐이다. 렌더러가 `PATH` 나 `ANTHROPIC_API_KEY` 를 이 저장소에
 *    밀어 넣어 스폰 env 를 흔드는 경로를 원천 차단한다.
 * 4. **전부-아니면-전무는 상위에서 유지**: 이 모듈은 키 하나의 값만 답한다. 세트가
 *    불완전할 때 프로파일 전체를 안 얹는 판단은 `applyVendorEnv` 의 몫이고, 이
 *    모듈이 그 규율을 우회하지 않는다(빈 문자열을 "설정됨" 으로 취급하지 않는다).
 *
 * ── electron 의존 ────────────────────────────────────────────────────────
 * `agent-config` 는 유닛테스트가 node 환경에서 그대로 import 하는 모듈이라 여기서
 * `electron` 을 정적 import 하면 그 테스트 전부가 깨진다. 그래서 **지연 require**
 * 하고, 못 얻으면 "저장소 사용 불가"(= 종전과 동일하게 `process.env` 만) 로
 * 안전하게 떨어진다. `npm run verify:models` 처럼 순수 node 로 도는 스크립트도
 * 같은 경로를 탄다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { maskSensitiveValue } from "./config-redaction";
import {
  MODEL_REGISTRY,
  HARNESS_NATIVE_VENDOR,
  vendorEnvSecretRef,
  type VendorId,
} from "./model-registry";

const STORE_DIR = path.join(os.homedir(), ".marblo");
const STORE_FILE = path.join(STORE_DIR, "vendor-secrets.enc.json");

/** 디스크 포맷. 값은 **전부 base64 암호문**이다(평문 필드는 존재하지 않는다). */
interface EncryptedVendorSecretStore {
  version: 1;
  /** env 키 이름 → base64(safeStorage 암호문) */
  keys: Record<string, string>;
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

/**
 * `electron` 모듈을 지연 로드한다. 순수 node(테스트·verify 스크립트)에서 이 require
 * 는 실패하거나 문자열(바이너리 경로)을 돌려주므로 형태를 확인해 걸러낸다.
 */
function loadElectron(): {
  safeStorage: SafeStorageLike;
  appReady: boolean;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as unknown;
    if (!electron || typeof electron !== "object") return null;
    const { safeStorage, app } = electron as {
      safeStorage?: SafeStorageLike;
      app?: { isReady(): boolean };
    };
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== "function")
      return null;
    return { safeStorage, appReady: app?.isReady() ?? false };
  } catch {
    return null;
  }
}

/**
 * 이 프로세스에서 벤더 시크릿을 읽고 쓸 수 있는가.
 *
 * `safeStorage` 는 `app.whenReady()` 이후에만 동작한다 — 그 전에 부르면 플랫폼에
 * 따라 throw 하거나 거짓 음성을 준다. 준비 전이면 "불가" 로 답하고, 호출자는
 * `process.env` 경로로 그대로 진행한다.
 */
export function isVendorSecretStoreAvailable(): boolean {
  const el = loadElectron();
  if (!el || !el.appReady) return false;
  try {
    return el.safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

// ── 저장 가능한 키(레지스트리 파생 allowlist) ─────────────────────────────

/**
 * 레지스트리가 실제로 `${...}` 로 참조하는 **모든** env 키 이름(값 아님).
 *
 * 하드코딩이 아니라 파생이라, 새 env-swap 벤더 행이 추가되면 저장소와 설정 UI 가
 * 자동으로 그 키를 받는다 — "레지스트리 행만 늘리면 끝" 이라는 (B)형 벤더의 편입
 * 비용을 이 축에서도 지킨다.
 */
export function allVendorEnvSecretKeys(): string[] {
  return [...storableKeys()].sort();
}

/**
 * allowlist 집합(레지스트리는 정적이라 한 번만 만든다). `getVendorSecret` 이
 * 스폰마다 도는 경로라 매번 레지스트리를 훑지 않는다.
 */
let _storableKeys: Set<string> | null = null;
function storableKeys(): Set<string> {
  if (_storableKeys) return _storableKeys;
  const keys = new Set<string>();
  for (const entry of MODEL_REGISTRY) {
    if (!entry.envProfile) continue;
    for (const value of Object.values(entry.envProfile)) {
      const ref = vendorEnvSecretRef(value);
      if (ref) keys.add(ref);
    }
  }
  _storableKeys = keys;
  return keys;
}

/** 이 env 키를 저장소가 받아도 되는가(레지스트리 참조 키만 허용). */
export function isStorableVendorSecretKey(envKey: string): boolean {
  return storableKeys().has(envKey);
}

/** 설정 UI 가 벤더 단위 카드를 그리기 위한, **값 없는** 요구사항 기술. */
export interface VendorSecretRequirement {
  vendor: VendorId;
  /** 이 벤더를 켜는 데 필요한 env 키 이름들(전부 있어야 켜진다 — all-or-nothing). */
  envKeys: string[];
  /** 이 벤더 프로파일을 쓰는 활성 모델 id 들(UI 표시·라이브 프로브 대상). */
  modelIds: string[];
}

/**
 * env-swap 벤더별 크레덴셜 요구사항. "무엇을 넣어야 이 벤더가 켜지나" 를 값 없이
 * 물어보는 창구이고, 설정 UI 의 카드 목록이 그대로 여기서 나온다.
 */
export function envSwapVendorRequirements(): VendorSecretRequirement[] {
  const byVendor = new Map<VendorId, { keys: Set<string>; models: string[] }>();
  for (const entry of MODEL_REGISTRY) {
    if (!entry.envProfile) continue;
    // 하네스 네이티브 벤더(= CLI 자기 로그인으로 붙는 행)는 등록 대상이 아니다.
    if (entry.provider === HARNESS_NATIVE_VENDOR[entry.harness]) continue;
    if (entry.status !== "active") continue;
    const refs = Object.values(entry.envProfile)
      .map((v) => vendorEnvSecretRef(v))
      .filter((k): k is string => Boolean(k));
    if (refs.length === 0) continue; // 시크릿이 필요 없는 프로파일(브라우저 인증형)
    const slot = byVendor.get(entry.provider) ?? {
      keys: new Set<string>(),
      models: [],
    };
    for (const ref of refs) slot.keys.add(ref);
    slot.models.push(entry.id);
    byVendor.set(entry.provider, slot);
  }
  return [...byVendor.entries()]
    .map(([vendor, slot]) => ({
      vendor,
      envKeys: [...slot.keys].sort(),
      modelIds: slot.models,
    }))
    .sort((a, b) => a.vendor.localeCompare(b.vendor));
}

// ── 디스크 I/O ────────────────────────────────────────────────────────────

/** 복호화된 { env 키 → 평문 } 캐시. 파일 mtime 이 바뀌면 무효화한다. */
let cache: { mtimeMs: number; values: Record<string, string> } | null = null;

function readStoreFile(): EncryptedVendorSecretStore | null {
  try {
    if (!fs.existsSync(STORE_FILE)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(STORE_FILE, "utf-8"),
    ) as Partial<EncryptedVendorSecretStore>;
    if (!parsed || typeof parsed !== "object" || !parsed.keys) return null;
    return { version: 1, keys: parsed.keys };
  } catch (err) {
    console.warn("[vendor-secrets] 저장소 읽기 실패:", err);
    return null;
  }
}

/** 복호화된 전체 맵. 실패한 항목은 **조용히 빠진다**(= 미설정 취급). */
function readDecrypted(): Record<string, string> {
  const el = loadElectron();
  if (!el || !el.appReady) return {};
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(STORE_FILE).mtimeMs;
  } catch {
    cache = null;
    return {};
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.values;

  const store = readStoreFile();
  const values: Record<string, string> = {};
  if (store) {
    for (const [key, b64] of Object.entries(store.keys)) {
      // allowlist 밖 키가 파일에 있어도 무시한다(수동 편집·구버전 잔재 방어).
      if (!isStorableVendorSecretKey(key)) continue;
      try {
        const plain = el.safeStorage.decryptString(Buffer.from(b64, "base64"));
        if (plain.trim()) values[key] = plain.trim();
      } catch {
        // 키체인 항목이 다른 머신/다른 계정 것이면 복호화가 실패한다. 키
        // **이름**만 남기고 값은 없는 것으로 친다.
        console.warn(`[vendor-secrets] 복호화 실패(무시): ${key}`);
      }
    }
  }
  cache = { mtimeMs, values };
  return values;
}

/**
 * 저장소를 **암호문 수준에서** 변형한다.
 *
 * ★평문 맵을 통째로 재암호화해 쓰지 않는 이유: 어떤 항목이 복호화에 실패하면
 * (키체인 항목이 다른 머신 것이거나 계정이 바뀐 경우) 그 키가 평문 맵에 없고,
 * 그대로 다시 쓰면 **남의 키를 조용히 지우게 된다**. 손대지 않은 항목은 암호문
 * 그대로 보존한다.
 */
function mutateStore(mutate: (keys: Record<string, string>) => void): void {
  const el = loadElectron();
  if (!el || !el.appReady || !el.safeStorage.isEncryptionAvailable()) {
    // BYOK 저장소와 동일한 P0-4 규율: 암호화가 안 되면 **평문으로 떨어지지 않고**
    // 실패를 사용자에게 드러낸다.
    throw new Error(
      "OS 키체인 암호화를 쓸 수 없어 벤더 키를 저장하지 않았습니다. " +
        "Linux 라면 libsecret-1-0 / gnome-keyring 설치 후 Marblo 를 재시작하세요. " +
        "macOS·Windows 에서 이 오류가 나면 support@marblo.app 로 알려주세요.",
    );
  }
  const keys = { ...(readStoreFile()?.keys ?? {}) };
  // allowlist 밖 잔재(수동 편집·구 벤더 행 제거)는 이 기회에 정리한다.
  for (const key of Object.keys(keys)) {
    if (!isStorableVendorSecretKey(key)) delete keys[key];
  }
  mutate(keys);

  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
  const store: EncryptedVendorSecretStore = { version: 1, keys };
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
  try {
    // 소유자만 읽게 좁힌다(암호문이지만 최소권한).
    fs.chmodSync(STORE_FILE, 0o600);
  } catch {
    /* Windows 등에서 실패해도 치명적이지 않다 */
  }
  cache = null;
}

/** 평문 하나를 암호문으로. 호출자는 `mutateStore` 안이라 가용성이 이미 보장된다. */
function encrypt(plain: string): string {
  const el = loadElectron();
  if (!el) throw new Error("safeStorage 사용 불가");
  return el.safeStorage.encryptString(plain).toString("base64");
}

// ── 공개 API ──────────────────────────────────────────────────────────────

/**
 * 저장된 평문 시크릿. **유일한 평문 반환 창구**이고 호출자는 스폰 env 를 조립하는
 * `resolveVendorEnvProfile` 하나다. 값이 없거나 저장소를 못 열면 undefined.
 */
export function getVendorSecret(envKey: string): string | undefined {
  if (!isStorableVendorSecretKey(envKey)) return undefined;
  const value = readDecrypted()[envKey];
  return value && value.trim() ? value.trim() : undefined;
}

/** 저장(덮어쓰기). 빈 문자열은 삭제와 같다. */
export function setVendorSecret(envKey: string, value: string): void {
  if (!isStorableVendorSecretKey(envKey)) {
    throw new Error(
      `저장할 수 없는 env 키입니다: ${envKey}. ` +
        `모델 레지스트리가 참조하는 키만 저장됩니다(${allVendorEnvSecretKeys().join(
          ", ",
        )}).`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed) {
    deleteVendorSecret(envKey);
    return;
  }
  mutateStore((keys) => {
    keys[envKey] = encrypt(trimmed);
  });
}

/** 삭제. 없던 키를 지워도 에러가 아니다(멱등). */
export function deleteVendorSecret(envKey: string): void {
  // 지울 게 없으면 저장소를 열지도 않는다 — 순수 node 에서 "삭제" 가 암호화
  // 불가 에러로 끝나는 건 거짓 실패다.
  const existing = readStoreFile()?.keys ?? {};
  if (!(envKey in existing)) return;
  mutateStore((keys) => {
    delete keys[envKey];
  });
}

/** 이 env 키의 값이 어디서 오는가. `none` 이면 스폰 때 프로파일이 안 얹힌다. */
export type VendorSecretSource = "env" | "store" | "none";

/** UI·로그가 쓰는 **값 없는** 상태 기술. `preview` 는 마스킹된 문자열이다. */
export interface VendorSecretStatus {
  envKey: string;
  source: VendorSecretSource;
  /** 앱 저장소에 값이 있는가(셸 env 와 무관). */
  storedInApp: boolean;
  /** 셸/`.env` 로 이미 들어와 있는가(있으면 그쪽이 이긴다). */
  presentInProcessEnv: boolean;
  /** `abcd***wxyz` 형태. 값이 없으면 빈 문자열. */
  preview: string;
}

/**
 * env 키 하나의 상태.
 *
 * ★우선순위는 `process.env` > 앱 저장소다. `v3/.env`/셸로 명시한 값을 GUI 저장소가
 * 조용히 덮으면 개발자가 무슨 키로 붙었는지 알 수 없게 된다(BYOK 의
 * `syncApiKeysToEnv` 도 같은 방향으로 판단했다). 대신 그 사실을 숨기지 않는다 —
 * `source` 가 항상 어느 쪽이 이겼는지 말하고, UI 가 그대로 표시한다.
 */
export function vendorSecretStatus(envKey: string): VendorSecretStatus {
  const fromEnv = process.env[envKey]?.trim();
  const fromStore = getVendorSecret(envKey);
  const effective = fromEnv || fromStore;
  return {
    envKey,
    source: fromEnv ? "env" : fromStore ? "store" : "none",
    storedInApp: Boolean(fromStore),
    presentInProcessEnv: Boolean(fromEnv),
    preview: effective ? maskSensitiveValue(effective) : "",
  };
}

/** 벤더 카드 하나 분량의 상태(값 없음). `ready` 가 all-or-nothing 판정이다. */
export interface VendorSecretVendorStatus extends VendorSecretRequirement {
  keys: VendorSecretStatus[];
  /** 필요한 키가 **전부** 있는가 — 하나라도 비면 스폰 시 프로파일을 안 얹는다. */
  ready: boolean;
}

/** 설정 UI 가 한 번에 받아가는 전체 스냅샷(시크릿 값 없음). */
export function vendorSecretsSnapshot(): {
  encryptionAvailable: boolean;
  vendors: VendorSecretVendorStatus[];
} {
  const vendors = envSwapVendorRequirements().map((req) => {
    const keys = req.envKeys.map((k) => vendorSecretStatus(k));
    return { ...req, keys, ready: keys.every((k) => k.source !== "none") };
  });
  return { encryptionAvailable: isVendorSecretStoreAvailable(), vendors };
}

/** 테스트 전용 — 복호화 캐시를 버린다. */
export function __resetVendorSecretCacheForTests(): void {
  cache = null;
}

// ── 존재함 / 없음 / 못읽음 (티켓 DmfFZdKpNig5AiZ7Bp3p) ─────────────────────

/**
 * 값 없이 "이 키가 있는가" 만 답하는 3상태.
 *
 *   present    — 쓸 수 있는 값이 있다(`process.env` 또는 복호화 성공).
 *   absent     — 어디에도 등록된 적이 없다(파일에 이 키 자체가 없다).
 *   unreadable — 파일엔 이 키가 **등록돼 있지만** 이 프로세스에서 값을 확인할 수
 *                없다 — Electron/safeStorage 가 없는 순수 node 프로세스이거나
 *                (예: MCP 로 스폰된 백엔드 에이전트 셸), 복호화 자체가 실패했다
 *                (다른 머신/계정의 키체인 항목).
 *
 * ★`getVendorSecret` 이 답하는 질문("쓸 수 있는 값을 다오")과 이 함수가 답하는
 * 질문("있기는 한가, 왜 모르는가")은 다르다. 전자를 없음/못읽음 구분 없이 그대로
 * "존재 안 함" 오진에 쓰면 안 된다는 것이 이 티켓의 요지다 — 8/21 에 등록된 키
 * 셋(UPSTAGE/DEEPSEEK/MINIMAX)이 순수 node 에이전트 셸에서 전부 "없음"으로
 * 보였던 사고가 그 오진이었다.
 *
 * ★파일 자체(`~/.marblo/vendor-secrets.enc.json`)는 평범한 JSON 이라 Electron
 * 없이도 `fs` 로 읽을 수 있다 — 오직 **값 복호화**만 safeStorage 를 요구한다.
 * 그래서 "이 키 이름이 파일에 등록돼 있는가"는 어느 프로세스에서든 답할 수 있고,
 * 이 구분이 이 함수의 핵심이다.
 */
export type VendorSecretPresence = "present" | "absent" | "unreadable";

/** `envKey` 하나의 존재 여부. 값은 어떤 경로로도 반환하지 않는다. */
export function vendorSecretPresence(envKey: string): VendorSecretPresence {
  if (!isStorableVendorSecretKey(envKey)) return "absent";
  if (process.env[envKey]?.trim()) return "present";

  const cipher = readStoreFile()?.keys[envKey];
  if (!cipher) return "absent";

  const el = loadElectron();
  if (!el || !el.appReady) return "unreadable";
  try {
    const plain = el.safeStorage.decryptString(Buffer.from(cipher, "base64"));
    return plain.trim() ? "present" : "absent";
  } catch {
    // 키체인 항목이 다른 머신/계정 것이면 복호화가 실패한다 — readDecrypted 와
    // 동일한 실패 모드이지만, 여기서는 "없음"이 아니라 "못읽음"으로 남긴다.
    return "unreadable";
  }
}

/** 여러 키의 존재 여부를 한 번에. 기본은 allowlist 전체(레지스트리가 참조하는 키). */
export function vendorSecretPresenceReport(
  envKeys: readonly string[] = allVendorEnvSecretKeys(),
): Record<string, VendorSecretPresence> {
  const out: Record<string, VendorSecretPresence> = {};
  for (const key of envKeys) out[key] = vendorSecretPresence(key);
  return out;
}
