import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * telegram-channels — 오케스트레이터 Telegram Channels 연결의 백엔드 단일 진실원
 * (텔레그램 T1·보안 민감).
 *
 * 한 프로젝트의 오케스트레이터를 텔레그램 채널(봇)에 연결하기 위한 설정
 * (botToken·chatId·enabled)을 로컬에 저장/조회하고, 신규 오케스트레이터 스폰 시
 * 주입할 채널 플래그를 결정하며, 활성화 전 프리플라이트를 수행한다.
 *
 * ★보안 불변식 (이 모듈의 존재 이유):
 *   - 권한 파일 access.json 의 생성/수정은 **로컬 설정 경로(설정 UI→IPC)에서만**
 *     일어난다. access.json 을 쓰는 함수(TelegramChannelStore.writeAccess)는
 *     private 이며, 외부로 노출되는 유일한 쓰기 경로는
 *     setTelegramChannelFromLocalSettings() 뿐이다 — 그 경로는 내부적으로
 *     LOCAL_SETTINGS_ORIGIN 가드를 통과해야만 파일을 쓴다.
 *   - 텔레그램에서 들어온 입력(인바운드)으로는 **절대 access.json 을 쓰지 않는다**.
 *     텔레그램 인바운드(다른 티켓의 bridge-server/mcp-server)는 이 모듈에서
 *     읽기 함수 getTelegramChannelAccess() 만 import 할 수 있고, 쓰기 경로는
 *     노출되지 않는다. 즉 인바운드는 권한 변경 불가 — 읽기/명령 트리거만.
 *   - access.json 은 봇 토큰류 비밀과 권한 화이트리스트를 담으므로 chmod 600.
 *
 * 설계 결정 (connection-store.ts 선례를 그대로 따른다):
 *   - 저장소: 로컬 JSON 파일. 채널 설정은 머신/사용자에 종속적이라 교차-에이전트
 *     보드용 Firestore 가 아니라 로컬 파일이 맞다. 저장 루트 `~/.marblo`.
 *   - 쓰기는 tmp→rename 원자 교체 — 부분 기록 방지.
 *   - 읽기는 절대 throw 하지 않고 파일 없음/깨짐이면 빈 상태.
 */

// ─── 채널 플러그인 / 스폰 플래그 ──────────────────────────────────────

/** 신규 오케스트레이터 스폰 시 함께 무는 욜로 플래그(권한 스킵). 채널 인바운드가
 * 무인 트리거하려면 권한 프롬프트가 없어야 하므로 채널과 짝으로 강제된다. */
export const YOLO_FLAG = "--dangerously-skip-permissions";

/** Claude Code 채널 플러그인 식별자(텔레그램). */
export const TELEGRAM_CHANNEL_PLUGIN =
  "plugin:telegram@claude-plugins-official";

/** `--channels <plugin>` 플래그 페어. orchestrator-manager 가 활성 시 args 에 push. */
export const TELEGRAM_CHANNEL_FLAGS: readonly string[] = [
  "--channels",
  TELEGRAM_CHANNEL_PLUGIN,
];

// ─── access.json 쓰기 출처 가드 ───────────────────────────────────────

/** access.json 쓰기를 허용하는 유일한 출처 — 로컬 설정 UI→IPC 경로. */
export const LOCAL_SETTINGS_ORIGIN = "local-settings" as const;
export type AccessWriteOrigin = typeof LOCAL_SETTINGS_ORIGIN;

/** 보안 불변식 위반(텔레그램 인바운드가 권한 파일을 쓰려 한 경우 등)을 나타내는 에러. */
export class TelegramAccessViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramAccessViolationError";
  }
}

// ─── 타입 ─────────────────────────────────────────────────────────────

/** 채널 인바운드가 할 수 있는 최대 행위. 'read'=조회만, 'trigger'=명령 트리거까지.
 * 'trigger' 라도 권한(access.json) 변경은 절대 불가 — 그건 로컬 설정만. */
export type InboundCapability = "read" | "trigger";

/** 오케스트레이터↔텔레그램 채널 연결 설정의 단일 진실원 레코드. */
export interface TelegramChannelConfig {
  /** 1차 키 — Marblo 프로젝트 id. */
  projectId: string;
  /** 텔레그램 봇 토큰. 미설정이면 null. */
  botToken: string | null;
  /** 인바운드/아웃바운드 대상 chatId(숫자 또는 @username). 미설정이면 null. */
  chatId: string | null;
  /** 채널 연결 활성 여부. 프리플라이트를 통과해야만 true 로 저장된다(방어선). */
  enabled: boolean;
  /** 인바운드 허용 행위. 기본 'trigger'. (권한 변경은 어떤 값이든 불가.) */
  inboundCapability: InboundCapability;
  /** 마지막 갱신 epoch ms. */
  updatedAt: number;
}

/** set 입력 — projectId 만 필수, 나머지는 부분 지정(기존값과 병합). */
export interface TelegramChannelInput {
  projectId: string;
  botToken?: string | null;
  chatId?: string | null;
  enabled?: boolean;
  inboundCapability?: InboundCapability;
}

/** 활성화 전 프리플라이트 결과. */
export interface ChannelPreflight {
  /** 모든 필수 점검 통과 → 활성화 가능. */
  ok: boolean;
  hasBotToken: boolean;
  hasChatId: boolean;
  /** 봇 토큰 형식 점검 통과 여부. */
  botTokenValid: boolean;
  /** chatId 형식 점검 통과 여부. */
  chatIdValid: boolean;
  /** 사람이 읽을 사유들(프론트 표시용). */
  issues: string[];
}

/** 프론트(T2)가 토글 잠금/상태 표시에 쓰는 합성 상태. */
export interface ChannelStatus {
  projectId: string;
  enabled: boolean;
  hasBotToken: boolean;
  hasChatId: boolean;
  preflight: ChannelPreflight;
  /** chatId/봇토큰 유효 → 토글 켤 수 있음. false 면 프론트가 토글 잠금. */
  canEnable: boolean;
  /** 실제 스폰에 채널 플래그가 주입되는 상태(enabled && preflight.ok). */
  active: boolean;
}

/** access.json — 권한 화이트리스트(로컬 설정만 씀, 인바운드는 읽기만). */
export interface ChannelAccess {
  projectId: string;
  /** 인바운드를 허용할 chatId 화이트리스트. 비면 전부 차단(=비활성과 동일). */
  allowedChatIds: string[];
  /** 인바운드가 할 수 있는 최대 행위. */
  inboundCapability: InboundCapability;
  /** 이 권한 레코드를 마지막으로 쓴 출처(감사용). 항상 local-settings. */
  origin: AccessWriteOrigin;
  updatedAt: number;
}

// ─── 경로/저장 ────────────────────────────────────────────────────────

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".marblo");
const DEFAULT_STORE_FILE = "telegram-channels.json";
/** 권한 파일 — chmod 600 로 보호. */
const DEFAULT_ACCESS_FILE = "telegram-access.json";

/** 권한/비밀 파일 권한 — 소유자 read/write 만(0600). */
const ACCESS_FILE_MODE = 0o600;

type StoredConfigs = Record<string, TelegramChannelConfig>;
type StoredAccess = Record<string, ChannelAccess>;

/**
 * 텔레그램 채널 설정 + 권한(access.json)의 로컬 단일 진실원. 테스트는 storeDir 을
 * 주입해 격리한다(connection-store.ts 의 storePath 주입과 동일 패턴).
 */
export class TelegramChannelStore {
  private configPath: string;
  private accessPath: string;

  constructor(opts?: { storeDir?: string }) {
    const dir = opts?.storeDir ?? DEFAULT_STORE_DIR;
    this.configPath = path.join(dir, DEFAULT_STORE_FILE);
    this.accessPath = path.join(dir, DEFAULT_ACCESS_FILE);
  }

  /** 설정 파일 절대경로(진단용). */
  getConfigPath(): string {
    return this.configPath;
  }
  /** 권한 파일 절대경로(진단용). */
  getAccessPath(): string {
    return this.accessPath;
  }

  // ── 설정(config) ──────────────────────────────────────────────────

  private readConfigs(): StoredConfigs {
    return readJsonMap<TelegramChannelConfig>(this.configPath);
  }

  private writeConfigs(data: StoredConfigs): void {
    atomicWriteJson(this.configPath, data);
  }

  /** projectId 의 채널 설정, 없으면 null. (읽기 — 절대 throw 안 함.) */
  getConfig(projectId: string): TelegramChannelConfig | null {
    return this.readConfigs()[projectId] ?? null;
  }

  /** 모든 채널 설정. */
  listConfigs(): TelegramChannelConfig[] {
    return Object.values(this.readConfigs());
  }

  /**
   * ★로컬 설정 경로 — 채널 설정을 저장하고 권한(access.json)을 동기화한다.
   * 이 함수만이 access.json 쓰기 경로(LOCAL_SETTINGS_ORIGIN)를 호출한다.
   *
   * 방어선: input.enabled 가 true 라도 프리플라이트가 실패하면 enabled 를 false
   * 로 강등 저장한다(chatId 없으면 활성 불가). 반환 status 의 canEnable/issues 로
   * 프론트가 토글을 잠근다.
   */
  setConfigFromLocalSettings(input: TelegramChannelInput): ChannelStatus {
    const existing = this.getConfig(input.projectId);

    // 부분 입력 병합: 입력 > 기존 > 기본값.
    const botToken =
      input.botToken !== undefined
        ? normalizeSecret(input.botToken)
        : (existing?.botToken ?? null);
    const chatId =
      input.chatId !== undefined
        ? normalizeId(input.chatId)
        : (existing?.chatId ?? null);
    const inboundCapability =
      input.inboundCapability ?? existing?.inboundCapability ?? "trigger";
    const requestedEnabled = input.enabled ?? existing?.enabled ?? false;

    const preflight = preflightChannel({ botToken, chatId });
    // chatId/토큰 유효하지 않으면 활성 불가 — 요청과 무관하게 강등(방어선).
    const enabled = requestedEnabled && preflight.ok;

    const merged: TelegramChannelConfig = {
      projectId: input.projectId,
      botToken,
      chatId,
      enabled,
      inboundCapability,
      updatedAt: now(),
    };

    const all = this.readConfigs();
    all[input.projectId] = merged;
    this.writeConfigs(all);

    // 권한(access.json) 동기화 — 활성+유효일 때만 chatId 화이트리스트, 아니면 비움.
    // 이 호출이 access.json 을 쓰는 유일한 합법 경로.
    this.writeAccess(
      {
        projectId: input.projectId,
        allowedChatIds: enabled && chatId ? [chatId] : [],
        inboundCapability,
        origin: LOCAL_SETTINGS_ORIGIN,
        updatedAt: now(),
      },
      LOCAL_SETTINGS_ORIGIN,
    );

    return this.getStatus(input.projectId);
  }

  /** 채널 설정과 권한 레코드를 함께 삭제. 있었으면 true. */
  remove(projectId: string): boolean {
    const configs = this.readConfigs();
    const had = projectId in configs;
    if (had) {
      delete configs[projectId];
      this.writeConfigs(configs);
    }
    // 권한도 같이 정리(로컬 설정 경로이므로 가드 통과).
    const access = this.readAccess();
    if (projectId in access) {
      delete access[projectId];
      this.writeAccessMap(access);
    }
    return had;
  }

  // ── 상태/프리플라이트 ─────────────────────────────────────────────

  /** projectId 의 합성 상태(프론트 토글 잠금/표시용). 레코드 없으면 빈 상태. */
  getStatus(projectId: string): ChannelStatus {
    const cfg = this.getConfig(projectId);
    const preflight = preflightChannel({
      botToken: cfg?.botToken ?? null,
      chatId: cfg?.chatId ?? null,
    });
    return {
      projectId,
      enabled: cfg?.enabled ?? false,
      hasBotToken: preflight.hasBotToken,
      hasChatId: preflight.hasChatId,
      preflight,
      canEnable: preflight.ok,
      active: (cfg?.enabled ?? false) && preflight.ok,
    };
  }

  /** 스폰에 채널 플래그를 주입해야 하는가(enabled && 프리플라이트 통과). */
  isActive(projectId: string): boolean {
    return this.getStatus(projectId).active;
  }

  // ── 권한(access.json) ─────────────────────────────────────────────

  private readAccess(): StoredAccess {
    return readJsonMap<ChannelAccess>(this.accessPath);
  }

  private writeAccessMap(data: StoredAccess): void {
    atomicWriteJson(this.accessPath, data, ACCESS_FILE_MODE);
  }

  /**
   * ★access.json 의 유일한 쓰기 지점. origin 이 LOCAL_SETTINGS_ORIGIN 이 아니면
   * TelegramAccessViolationError 를 던진다 — 텔레그램 인바운드 경로가 (실수로라도)
   * 이 함수에 도달해도 권한을 변경하지 못한다. private 이라 외부에서 직접 호출 불가;
   * 외부 합법 경로는 setConfigFromLocalSettings() 뿐이다.
   */
  private writeAccess(access: ChannelAccess, origin: string): void {
    if (origin !== LOCAL_SETTINGS_ORIGIN) {
      throw new TelegramAccessViolationError(
        `access.json write rejected: origin "${origin}" is not "${LOCAL_SETTINGS_ORIGIN}". ` +
          "Telegram inbound MUST NOT mutate permissions — only the local settings path may.",
      );
    }
    const all = this.readAccess();
    all[access.projectId] = { ...access, origin: LOCAL_SETTINGS_ORIGIN };
    this.writeAccessMap(all);
  }

  /**
   * 권한 레코드 읽기 — 텔레그램 인바운드가 인가 판정에 쓰는 read-only 진입점.
   * 없으면 null. 절대 throw 안 함. (쓰기 경로는 노출되지 않는다.)
   */
  getAccess(projectId: string): ChannelAccess | null {
    return this.readAccess()[projectId] ?? null;
  }
}

// ─── 순수 헬퍼 ────────────────────────────────────────────────────────

/** 빈/공백 문자열은 null 로. 비밀(토큰)은 trim 만 하고 그대로 보존. */
function normalizeSecret(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** chatId/식별자 정규화 — trim, 빈 값은 null. */
function normalizeId(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** 텔레그램 봇 토큰 형식: `<숫자>:<영숫자_-_>` (예: 123456789:AAH...). 보수적 점검. */
const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
/** chatId: 숫자(그룹은 음수 가능) 또는 @username. */
const CHAT_ID_RE = /^(-?\d+|@[A-Za-z0-9_]{4,})$/;

/**
 * 채널 활성화 전 프리플라이트. botToken/chatId 유효성을 점검한다. chatId 가
 * 비어 있으면 ok=false → 활성화 불가(토글 잠금 신호). 순수 함수.
 */
export function preflightChannel(input: {
  botToken: string | null;
  chatId: string | null;
}): ChannelPreflight {
  const token = normalizeSecret(input.botToken);
  const chat = normalizeId(input.chatId);
  const hasBotToken = !!token;
  const hasChatId = !!chat;
  const botTokenValid = hasBotToken && BOT_TOKEN_RE.test(token!);
  const chatIdValid = hasChatId && CHAT_ID_RE.test(chat!);

  const issues: string[] = [];
  if (!hasBotToken) issues.push("봇 토큰이 비어 있습니다.");
  else if (!botTokenValid) issues.push("봇 토큰 형식이 올바르지 않습니다.");
  if (!hasChatId) issues.push("chatId 가 비어 있어 활성화할 수 없습니다.");
  else if (!chatIdValid) issues.push("chatId 형식이 올바르지 않습니다.");

  return {
    ok: botTokenValid && chatIdValid,
    hasBotToken,
    hasChatId,
    botTokenValid,
    chatIdValid,
    issues,
  };
}

/** epoch ms — 테스트에서 모킹 쉽게 하려고 함수로 감싼다. */
function now(): number {
  return Date.now();
}

/** JSON 맵 읽기 — 파일 없음/깨짐이면 빈 맵(절대 throw 안 함). */
function readJsonMap<T>(filePath: string): Record<string, T> {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, T>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * JSON 을 tmp→rename 으로 원자 교체(connection-store 패턴). mode 가 주어지면
 * 파일 권한을 그 값으로 고정(chmod) — 권한/비밀 파일(access.json)을 0600 으로
 * 보호한다. tmp 도 같은 mode 로 생성해 잠깐이라도 느슨한 권한이 노출되지 않게 한다.
 */
function atomicWriteJson(filePath: string, data: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const json = JSON.stringify(data, null, 2);
  if (mode !== undefined) {
    // wx 가 아니라 w — 재시도 시 잔존 tmp 를 덮어쓴다. mode 로 생성 권한 고정.
    fs.writeFileSync(tmp, json, { encoding: "utf-8", mode });
    // 기존에 더 느슨한 권한으로 만들어졌을 수 있으니 명시적 chmod 로 강제.
    fs.chmodSync(tmp, mode);
  } else {
    fs.writeFileSync(tmp, json, "utf-8");
  }
  fs.renameSync(tmp, filePath);
  if (mode !== undefined) {
    // rename 으로 옮긴 최종 파일에도 권한 재확정(기존 파일 권한 승계 방지).
    fs.chmodSync(filePath, mode);
  }
}

// ─── 기본 싱글톤 + 모듈 레벨 편의 함수 ────────────────────────────────
// main.ts·orchestrator-manager·(텔레그램 인바운드)는 이 함수들만 쓰면 된다.

let _defaultStore: TelegramChannelStore | null = null;

/** 프로세스 공유 기본 store(~/.marblo/telegram-channels.json + telegram-access.json). */
export function getTelegramChannelStore(): TelegramChannelStore {
  if (!_defaultStore) _defaultStore = new TelegramChannelStore();
  return _defaultStore;
}

/** 테스트 훅 — 기본 store 주입/리셋. */
export function _setDefaultTelegramChannelStore(
  store: TelegramChannelStore | null,
): void {
  _defaultStore = store;
}

/** projectId 의 채널 설정, 없으면 null. (읽기) */
export function getTelegramChannelConfig(
  projectId: string,
): TelegramChannelConfig | null {
  return getTelegramChannelStore().getConfig(projectId);
}

/** 모든 채널 설정. */
export function listTelegramChannelConfigs(): TelegramChannelConfig[] {
  return getTelegramChannelStore().listConfigs();
}

/** ★로컬 설정 쓰기 — 설정 저장 + 권한(access.json) 동기화. 합성 상태 반환. */
export function setTelegramChannelFromLocalSettings(
  input: TelegramChannelInput,
): ChannelStatus {
  return getTelegramChannelStore().setConfigFromLocalSettings(input);
}

/** projectId 의 합성 상태(프론트 토글 잠금/표시용). */
export function getTelegramChannelStatus(projectId: string): ChannelStatus {
  return getTelegramChannelStore().getStatus(projectId);
}

/** 스폰에 채널 플래그를 주입해야 하는가(enabled && 프리플라이트 통과). */
export function isTelegramChannelActive(projectId: string): boolean {
  return getTelegramChannelStore().isActive(projectId);
}

/** 채널 설정/권한 삭제. */
export function removeTelegramChannel(projectId: string): boolean {
  return getTelegramChannelStore().remove(projectId);
}

/**
 * ★권한 레코드 읽기 — 텔레그램 인바운드(bridge-server/mcp-server, 다른 티켓)가
 * 인가 판정에 쓰는 read-only 진입점. 쓰기 함수는 이 모듈에서 노출되지 않으므로
 * 인바운드는 권한을 변경할 수 없다(보안 불변식).
 */
export function getTelegramChannelAccess(
  projectId: string,
): ChannelAccess | null {
  return getTelegramChannelStore().getAccess(projectId);
}

/**
 * 활성 채널의 스폰 주입 플래그를 돌려준다. 활성이 아니면 빈 배열.
 * orchestrator-manager 가 launchConfig.args 에 spread 한다.
 */
export function telegramChannelLaunchFlags(projectId: string): string[] {
  return isTelegramChannelActive(projectId) ? [...TELEGRAM_CHANNEL_FLAGS] : [];
}
