import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * slack-channels — 오케스트레이터 Slack 채널 연결의 백엔드 단일 진실원.
 *
 * telegram-channels.ts 의 **구조를 그대로 미러링**한다(새 패턴 발명 금지):
 * 로컬 JSON 저장소 + tmp→rename 원자 교체 + 읽기는 절대 throw 안 함 +
 * 권한 파일(access)의 유일한 쓰기 경로는 가드된 로컬 설정 경로.
 *
 * ★보안 불변식 (텔레그램과 동일):
 *   - 권한 파일 slack-access.json 의 생성/수정은 **로컬 설정 경로(설정 UI→IPC)
 *     에서만** 일어난다. 쓰기 함수(SlackChannelStore.writeAccess)는 private 이며,
 *     외부로 노출되는 유일한 쓰기 경로는 setSlackChannelFromLocalSettings() 뿐,
 *     그 경로는 LOCAL_SETTINGS_ORIGIN 가드를 통과해야만 파일을 쓴다.
 *   - Slack 에서 들어온 입력(인바운드)으로는 **절대 권한 파일을 쓰지 않는다**.
 *     인바운드(slack-poller)는 읽기 함수 getSlackChannelAccess() 만 import 한다.
 *   - 설정/권한 파일 모두 chmod 600 (텔레그램은 access 만 0600 이었지만, 여기는
 *     설정 파일에도 토큰이 살므로 둘 다 조인다).
 *
 * ★텔레그램과 다른 점 (Slack 의 현실이 강제하는 것만):
 *   1. 토큰이 **둘**이다 — bot token(xoxb, Web API 호출용)과 app token(xapp,
 *      Socket Mode 연결용). 둘 다 있어야 왕복이 성립한다.
 *   2. 시크릿을 **평문으로 두지 않는다**. Electron safeStorage(macOS Keychain /
 *      Windows DPAPI / Linux libsecret)로 암호화해 기록하고, 암호화가 불가능한
 *      환경(순수 node 테스트/스크립트)에서만 평문으로 떨어진다 — 그 사실은
 *      status.secretsEncrypted 로 드러난다(조용한 강등 금지).
 *      vendor-secrets.ts 를 재사용하지 않는 이유: 그 저장소는 MODEL_REGISTRY 가
 *      `${ENV_KEY}` 로 참조하는 env 키 이름 allowlist 전용이라 Slack 토큰이
 *      들어갈 자리가 없다. 그래서 저장소가 아니라 **규율**(암호화 우선·평문
 *      미반환·마스킹 창구)만 이식한다.
 */

// ─── access 쓰기 출처 가드 ────────────────────────────────────────────

/** access 파일 쓰기를 허용하는 유일한 출처 — 로컬 설정 UI→IPC 경로. */
export const LOCAL_SETTINGS_ORIGIN = "local-settings" as const;
export type AccessWriteOrigin = typeof LOCAL_SETTINGS_ORIGIN;

/** 보안 불변식 위반(Slack 인바운드가 권한 파일을 쓰려 한 경우 등). */
export class SlackAccessViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackAccessViolationError";
  }
}

// ─── 타입 ─────────────────────────────────────────────────────────────

/** 채널 인바운드가 할 수 있는 최대 행위. telegram-channels 와 동일한 의미. */
export type InboundCapability = "read" | "trigger";

/** 오케스트레이터↔Slack 채널 연결 설정의 단일 진실원 레코드. */
export interface SlackChannelConfig {
  /** 1차 키 — Marblo 프로젝트 id. */
  projectId: string;
  /** Slack bot token(xoxb-…). Web API(chat.postMessage/auth.test)용. */
  botToken: string | null;
  /** Slack app token(xapp-…). Socket Mode(apps.connections.open)용. */
  appToken: string | null;
  /** 인바운드/아웃바운드 대상 채널 id(C…/G…/D…). 미설정이면 null. */
  channelId: string | null;
  /** 채널 연결 활성 여부. 프리플라이트를 통과해야만 true 로 저장된다(방어선). */
  enabled: boolean;
  /** 인바운드 허용 행위. 기본 'trigger'. (권한 변경은 어떤 값이든 불가.) */
  inboundCapability: InboundCapability;
  /** 마지막 갱신 epoch ms. */
  updatedAt: number;
}

/** set 입력 — projectId 만 필수, 나머지는 부분 지정(기존값과 병합). */
export interface SlackChannelInput {
  projectId: string;
  botToken?: string | null;
  appToken?: string | null;
  channelId?: string | null;
  enabled?: boolean;
  inboundCapability?: InboundCapability;
}

/** 활성화 전 프리플라이트 결과. */
export interface SlackChannelPreflight {
  /** 모든 필수 점검 통과 → 활성화 가능. */
  ok: boolean;
  hasBotToken: boolean;
  hasAppToken: boolean;
  hasChannelId: boolean;
  botTokenValid: boolean;
  appTokenValid: boolean;
  channelIdValid: boolean;
  /** 사람이 읽을 사유들(프론트 표시용). */
  issues: string[];
}

/** 프론트가 토글 잠금/상태 표시에 쓰는 합성 상태. ★시크릿 원문 미포함. */
export interface SlackChannelStatus {
  projectId: string;
  enabled: boolean;
  hasBotToken: boolean;
  hasAppToken: boolean;
  hasChannelId: boolean;
  channelId: string | null;
  inboundCapability: InboundCapability;
  preflight: SlackChannelPreflight;
  /** 토큰/채널이 유효 → 토글을 켤 수 있음. false 면 프론트가 토글 잠금. */
  canEnable: boolean;
  /** 실제로 Socket Mode 연결이 붙는 상태(enabled && preflight.ok). */
  active: boolean;
  /** 디스크의 토큰이 safeStorage 로 암호화돼 있는가(조용한 평문 강등 방지). */
  secretsEncrypted: boolean;
}

/** 권한 파일 — 인바운드 화이트리스트(로컬 설정만 씀, 인바운드는 읽기만). */
export interface SlackChannelAccess {
  projectId: string;
  /** 인바운드를 허용할 채널 id 화이트리스트. 비면 전부 허용(=텔레그램과 동일 의미). */
  allowedChannelIds: string[];
  /** 인바운드가 할 수 있는 최대 행위. */
  inboundCapability: InboundCapability;
  /** 이 권한 레코드를 마지막으로 쓴 출처(감사용). 항상 local-settings. */
  origin: AccessWriteOrigin;
  updatedAt: number;
}

// ─── 경로/저장 ────────────────────────────────────────────────────────

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".marblo");
const DEFAULT_STORE_FILE = "slack-channels.json";
const DEFAULT_ACCESS_FILE = "slack-access.json";

/** 권한/비밀 파일 권한 — 소유자 read/write 만(0600). */
const SECRET_FILE_MODE = 0o600;

/**
 * 디스크 표현 — 토큰은 `enc`(safeStorage base64) 또는 `plain` 중 하나로만 산다.
 * 공개 타입(SlackChannelConfig)은 평문 필드를 갖지만, 그 평문이 디스크에 그대로
 * 눕지 않도록 직렬화 계층에서 갈라 놓는다.
 */
interface StoredSecret {
  /** safeStorage 로 암호화한 base64. 암호화가 가능했을 때만 존재. */
  enc?: string;
  /** 암호화 불가 환경(순수 node)에서의 평문 폴백. */
  plain?: string;
}

interface StoredSlackChannel {
  projectId: string;
  botToken: StoredSecret | null;
  appToken: StoredSecret | null;
  channelId: string | null;
  enabled: boolean;
  inboundCapability: InboundCapability;
  updatedAt: number;
}

type StoredConfigs = Record<string, StoredSlackChannel>;
type StoredAccess = Record<string, SlackChannelAccess>;

// ─── safeStorage (지연 로드 — 순수 node 에서도 import 가능해야 한다) ─────

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

/**
 * electron 의 safeStorage 를 지연 로드한다. 유닛테스트/verify 스크립트는 node 로
 * 이 모듈을 그대로 import 하므로 정적 import 는 금물(vendor-secrets.ts 와 동일한
 * 이유·동일한 형태 검사). 못 얻으면 null → 평문 폴백.
 */
function loadSafeStorage(): SafeStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as unknown;
    if (!electron || typeof electron !== "object") return null;
    const { safeStorage } = electron as { safeStorage?: SafeStorageLike };
    if (
      !safeStorage ||
      typeof safeStorage.isEncryptionAvailable !== "function"
    ) {
      return null;
    }
    return safeStorage.isEncryptionAvailable() ? safeStorage : null;
  } catch {
    return null;
  }
}

/** 평문 → 디스크 표현. 암호화 가능하면 enc, 아니면 plain 폴백. */
function sealSecret(value: string | null): StoredSecret | null {
  if (!value) return null;
  const safeStorage = loadSafeStorage();
  if (safeStorage) {
    try {
      return { enc: safeStorage.encryptString(value).toString("base64") };
    } catch {
      // 암호화가 런타임에 실패하면(키체인 잠금 등) 평문으로라도 보존한다 —
      // 파일은 어차피 0600 이고, 조용한 유실보다 낫다. status.secretsEncrypted
      // 가 false 로 드러나므로 숨겨지지 않는다.
    }
  }
  return { plain: value };
}

/** 디스크 표현 → 평문. 복호 실패(다른 기기/키체인 변경)는 null. */
function openSecret(stored: StoredSecret | null | undefined): string | null {
  if (!stored) return null;
  if (typeof stored.enc === "string" && stored.enc) {
    const safeStorage = loadSafeStorage();
    if (!safeStorage) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored.enc, "base64"));
    } catch {
      return null;
    }
  }
  return typeof stored.plain === "string" && stored.plain ? stored.plain : null;
}

/** 이 레코드의 시크릿이 전부 암호화 상태인가(하나라도 평문이면 false). */
function isSealed(record: StoredSlackChannel): boolean {
  const secrets = [record.botToken, record.appToken].filter(
    (s): s is StoredSecret => !!s,
  );
  if (secrets.length === 0) return true; // 시크릿이 없으면 노출도 없다
  return secrets.every((s) => typeof s.enc === "string" && !!s.enc);
}

// ─── 스토어 ───────────────────────────────────────────────────────────

/**
 * Slack 채널 설정 + 권한의 로컬 단일 진실원. 테스트는 storeDir 을 주입해
 * 격리한다(telegram-channels.TelegramChannelStore 와 동일 패턴).
 */
export class SlackChannelStore {
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

  private readStored(): StoredConfigs {
    const raw = readJsonMap<Partial<StoredSlackChannel>>(this.configPath);
    const out: StoredConfigs = {};
    for (const [projectId, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object") continue;
      out[projectId] = {
        projectId,
        botToken: normalizeStoredSecret(value.botToken),
        appToken: normalizeStoredSecret(value.appToken),
        channelId: normalizeId(
          typeof value.channelId === "string" ? value.channelId : null,
        ),
        enabled: value.enabled === true,
        inboundCapability:
          value.inboundCapability === "read" ? "read" : "trigger",
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
      };
    }
    return out;
  }

  private writeStored(data: StoredConfigs): void {
    atomicWriteJson(this.configPath, data, SECRET_FILE_MODE);
  }

  private toConfig(record: StoredSlackChannel): SlackChannelConfig {
    return {
      projectId: record.projectId,
      botToken: openSecret(record.botToken),
      appToken: openSecret(record.appToken),
      channelId: record.channelId,
      enabled: record.enabled,
      inboundCapability: record.inboundCapability,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * projectId 의 채널 설정, 없으면 null. (읽기 — 절대 throw 안 함.)
   * ★평문 토큰을 담아 돌려준다 — 호출자는 electron main 내부(poller/health)뿐이며,
   * IPC/렌더러 창구는 getStatus() 를 쓴다(시크릿 미포함).
   */
  getConfig(projectId: string): SlackChannelConfig | null {
    const record = this.readStored()[projectId];
    return record ? this.toConfig(record) : null;
  }

  /** 모든 채널 설정(평문 토큰 포함 — main 내부 전용). */
  listConfigs(): SlackChannelConfig[] {
    return Object.values(this.readStored()).map((r) => this.toConfig(r));
  }

  /**
   * ★로컬 설정 경로 — 채널 설정을 저장하고 권한을 동기화한다. 이 함수만이
   * 권한 파일 쓰기 경로(LOCAL_SETTINGS_ORIGIN)를 호출한다.
   *
   * 방어선: input.enabled 가 true 라도 프리플라이트가 실패하거나 app token 이
   * 다른 활성 프로젝트와 겹치면 enabled 를 false 로 강등 저장한다.
   */
  setConfigFromLocalSettings(input: SlackChannelInput): SlackChannelStatus {
    const all = this.readStored();
    const existing = all[input.projectId];

    // 부분 입력 병합: 입력 > 기존 > 기본값. 미지정 시크릿은 기존 디스크
    // 표현(암호문)을 그대로 옮겨 재암호화 왕복을 피한다.
    const botToken =
      input.botToken !== undefined
        ? sealSecret(normalizeSecret(input.botToken))
        : (existing?.botToken ?? null);
    const appToken =
      input.appToken !== undefined
        ? sealSecret(normalizeSecret(input.appToken))
        : (existing?.appToken ?? null);
    const channelId =
      input.channelId !== undefined
        ? normalizeId(input.channelId)
        : (existing?.channelId ?? null);
    const inboundCapability =
      input.inboundCapability ?? existing?.inboundCapability ?? "trigger";
    const requestedEnabled = input.enabled ?? existing?.enabled ?? false;

    const preflight = preflightSlackChannel({
      botToken: openSecret(botToken),
      appToken: openSecret(appToken),
      channelId,
    });
    // ★app token 소유권 규칙(1 Slack 앱 = 1 프로젝트): Socket Mode 는 같은 app
    // token 으로 연 모든 연결에 **같은 이벤트를 복제 전달**한다. 두 프로젝트가
    // 한 토큰을 쓰면 한 멘션이 두 오케에 주입돼 중복 응답이 난다.
    const conflicts = this.findAppTokenConflicts(
      input.projectId,
      openSecret(appToken),
    );
    const enabled = requestedEnabled && preflight.ok && conflicts.length === 0;

    all[input.projectId] = {
      projectId: input.projectId,
      botToken,
      appToken,
      channelId,
      enabled,
      inboundCapability,
      updatedAt: now(),
    };
    this.writeStored(all);

    // 권한 동기화 — 활성+유효일 때만 채널 화이트리스트, 아니면 비움.
    // 이 호출이 권한 파일을 쓰는 유일한 합법 경로.
    this.writeAccess(
      {
        projectId: input.projectId,
        allowedChannelIds: enabled && channelId ? [channelId] : [],
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
    const configs = this.readStored();
    const had = projectId in configs;
    if (had) {
      delete configs[projectId];
      this.writeStored(configs);
    }
    const access = this.readAccess();
    if (projectId in access) {
      delete access[projectId];
      this.writeAccessMap(access);
    }
    return had;
  }

  // ── 상태/프리플라이트 ─────────────────────────────────────────────

  /** projectId 의 합성 상태(프론트/IPC 창구). ★시크릿 원문을 담지 않는다. */
  getStatus(projectId: string): SlackChannelStatus {
    const record = this.readStored()[projectId] ?? null;
    const botToken = openSecret(record?.botToken);
    const appToken = openSecret(record?.appToken);
    const preflight = preflightSlackChannel({
      botToken,
      appToken,
      channelId: record?.channelId ?? null,
    });

    const conflicts = this.findAppTokenConflicts(projectId, appToken);
    if (conflicts.length > 0) {
      preflight.issues.push(
        `이 Slack app token 은 이미 다른 프로젝트(${conflicts.join(", ")})의 ` +
          `활성 채널이 사용 중입니다. Socket Mode 는 같은 app token 의 모든 ` +
          `연결에 같은 이벤트를 복제 전달하므로 한 멘션에 두 오케가 답합니다 — ` +
          `프로젝트마다 별도의 Slack 앱을 만들어 연결하세요.`,
      );
    }
    // 시크릿이 있는데 암호화되지 않았다면(키체인 없는 환경) 조용히 넘기지 않는다.
    const secretsEncrypted = record ? isSealed(record) : true;
    if (record && !secretsEncrypted) {
      preflight.issues.push(
        "이 기기에서 OS 보안 저장소(safeStorage)를 쓸 수 없어 Slack 토큰이 " +
          "평문으로 저장돼 있습니다(파일 권한 0600). 키체인이 잠겨 있지 않은지 " +
          "확인한 뒤 토큰을 다시 저장하면 암호화됩니다.",
      );
    }

    const channelSharers = this.listChannelIdSharers(
      projectId,
      record?.channelId ?? null,
    );
    if (channelSharers.length > 0) {
      preflight.issues.push(
        `이 채널은 다른 프로젝트(${channelSharers.join(", ")})의 활성 채널도 ` +
          `사용 중입니다. 같은 채널에 여러 프로젝트의 응답이 도착하므로, ` +
          `구분을 위해 발신 메시지에 [프로젝트명] 접두가 자동으로 붙습니다.`,
      );
    }

    return {
      projectId,
      enabled: record?.enabled ?? false,
      hasBotToken: preflight.hasBotToken,
      hasAppToken: preflight.hasAppToken,
      hasChannelId: preflight.hasChannelId,
      channelId: record?.channelId ?? null,
      inboundCapability: record?.inboundCapability ?? "trigger",
      preflight,
      canEnable: preflight.ok && conflicts.length === 0,
      active: (record?.enabled ?? false) && preflight.ok,
      secretsEncrypted,
    };
  }

  /**
   * 이 프로젝트가 아닌 다른 **활성(enabled)** 프로젝트 중 같은 app token 을 쓰는
   * projectId 목록. Socket Mode 이벤트 복제 전달 때문에 이 목록이 비어야만
   * 활성화 가능하다(1 Slack 앱 = 1 프로젝트 규칙).
   */
  findAppTokenConflicts(
    selfProjectId: string,
    appToken: string | null,
  ): string[] {
    const token = normalizeSecret(appToken);
    if (!token) return [];
    return Object.values(this.readStored())
      .filter((r) => r.projectId !== selfProjectId && r.enabled)
      .filter((r) => openSecret(r.appToken) === token)
      .map((r) => r.projectId)
      .sort();
  }

  /**
   * 같은 채널로 발신하도록 설정된 **다른 활성 프로젝트** 목록. 차단이 아니라
   * 구분 수단(발신 접두 [프로젝트]) 판정 근거 — telegram 의 listChatIdSharers 와
   * 같은 역할.
   */
  listChannelIdSharers(
    selfProjectId: string,
    channelId: string | null,
  ): string[] {
    const channel = normalizeId(channelId);
    if (!channel) return [];
    return Object.values(this.readStored())
      .filter(
        (r) =>
          r.projectId !== selfProjectId && r.enabled && r.channelId === channel,
      )
      .map((r) => r.projectId)
      .sort();
  }

  /** Socket Mode 연결을 붙여야 하는가(enabled && 프리플라이트 통과). */
  isActive(projectId: string): boolean {
    return this.getStatus(projectId).active;
  }

  // ── 권한(access) ──────────────────────────────────────────────────

  private readAccess(): StoredAccess {
    return readJsonMap<SlackChannelAccess>(this.accessPath);
  }

  private writeAccessMap(data: StoredAccess): void {
    atomicWriteJson(this.accessPath, data, SECRET_FILE_MODE);
  }

  /**
   * ★권한 파일의 유일한 쓰기 지점. origin 이 LOCAL_SETTINGS_ORIGIN 이 아니면
   * SlackAccessViolationError 를 던진다 — Slack 인바운드 경로가 (실수로라도)
   * 이 함수에 도달해도 권한을 변경하지 못한다. private 이라 외부 직접 호출 불가;
   * 외부 합법 경로는 setConfigFromLocalSettings() 뿐이다.
   */
  private writeAccess(access: SlackChannelAccess, origin: string): void {
    if (origin !== LOCAL_SETTINGS_ORIGIN) {
      throw new SlackAccessViolationError(
        `slack access write rejected: origin "${origin}" is not "${LOCAL_SETTINGS_ORIGIN}". ` +
          "Slack inbound MUST NOT mutate permissions — only the local settings path may.",
      );
    }
    const all = this.readAccess();
    all[access.projectId] = { ...access, origin: LOCAL_SETTINGS_ORIGIN };
    this.writeAccessMap(all);
  }

  /**
   * 권한 레코드 읽기 — Slack 인바운드가 인가 판정에 쓰는 read-only 진입점.
   * 없으면 null. 절대 throw 안 함. (쓰기 경로는 노출되지 않는다.)
   */
  getAccess(projectId: string): SlackChannelAccess | null {
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

/** 식별자 정규화 — trim, 빈 값은 null. */
function normalizeId(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** 디스크에서 읽은 시크릿 값을 신뢰-경계 검증해 정규화한다. */
function normalizeStoredSecret(raw: unknown): StoredSecret | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<StoredSecret>;
  if (typeof s.enc === "string" && s.enc) return { enc: s.enc };
  if (typeof s.plain === "string" && s.plain) return { plain: s.plain };
  return null;
}

/** bot token: `xoxb-` 접두. Slack 은 길이를 보장하지 않으므로 보수적 하한만. */
const BOT_TOKEN_RE = /^xoxb-[A-Za-z0-9-]{10,}$/;
/** app token(Socket Mode): `xapp-` 접두. */
const APP_TOKEN_RE = /^xapp-[A-Za-z0-9-]{10,}$/;
/** 채널 id: C(공개)/G(비공개)/D(DM) + 대문자·숫자. */
const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{6,}$/;

/**
 * 채널 활성화 전 프리플라이트. 두 토큰과 채널 id 유효성을 점검한다. 하나라도
 * 비거나 형식이 어긋나면 ok=false → 활성화 불가(토글 잠금 신호). 순수 함수.
 */
export function preflightSlackChannel(input: {
  botToken: string | null;
  appToken: string | null;
  channelId: string | null;
}): SlackChannelPreflight {
  const bot = normalizeSecret(input.botToken);
  const app = normalizeSecret(input.appToken);
  const channel = normalizeId(input.channelId);
  const hasBotToken = !!bot;
  const hasAppToken = !!app;
  const hasChannelId = !!channel;
  const botTokenValid = hasBotToken && BOT_TOKEN_RE.test(bot!);
  const appTokenValid = hasAppToken && APP_TOKEN_RE.test(app!);
  const channelIdValid = hasChannelId && CHANNEL_ID_RE.test(channel!);

  const issues: string[] = [];
  if (!hasBotToken) issues.push("bot token(xoxb-…)이 비어 있습니다.");
  else if (!botTokenValid)
    issues.push(
      "bot token 형식이 올바르지 않습니다(xoxb- 로 시작해야 합니다).",
    );
  if (!hasAppToken) issues.push("app token(xapp-…)이 비어 있습니다.");
  else if (!appTokenValid)
    issues.push(
      "app token 형식이 올바르지 않습니다(Socket Mode 용 xapp- 토큰이어야 합니다).",
    );
  if (!hasChannelId) issues.push("채널 id 가 비어 있어 활성화할 수 없습니다.");
  else if (!channelIdValid)
    issues.push("채널 id 형식이 올바르지 않습니다(예: C0123ABCDEF).");

  return {
    ok: botTokenValid && appTokenValid && channelIdValid,
    hasBotToken,
    hasAppToken,
    hasChannelId,
    botTokenValid,
    appTokenValid,
    channelIdValid,
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
 * JSON 을 tmp→rename 으로 원자 교체하며 파일 권한을 mode 로 고정한다
 * (telegram-channels.atomicWriteJson 과 동일). tmp 도 같은 mode 로 만들어
 * 잠깐이라도 느슨한 권한이 노출되지 않게 한다.
 */
function atomicWriteJson(filePath: string, data: unknown, mode: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, json, { encoding: "utf-8", mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
  // rename 으로 옮긴 최종 파일에도 권한 재확정(기존 파일 권한 승계 방지).
  fs.chmodSync(filePath, mode);
}

// ─── 기본 싱글톤 + 모듈 레벨 편의 함수 ────────────────────────────────
// main.ts·slack-poller·slack-health 는 이 함수들만 쓰면 된다.

let _defaultStore: SlackChannelStore | null = null;

/** 프로세스 공유 기본 store(~/.marblo/slack-channels.json + slack-access.json). */
export function getSlackChannelStore(): SlackChannelStore {
  if (!_defaultStore) _defaultStore = new SlackChannelStore();
  return _defaultStore;
}

/** 테스트 훅 — 기본 store 주입/리셋. */
export function _setDefaultSlackChannelStore(
  store: SlackChannelStore | null,
): void {
  _defaultStore = store;
}

/** projectId 의 채널 설정, 없으면 null. (main 내부 — 평문 토큰 포함) */
export function getSlackChannelConfig(
  projectId: string,
): SlackChannelConfig | null {
  return getSlackChannelStore().getConfig(projectId);
}

/** 모든 채널 설정. (main 내부 — 평문 토큰 포함) */
export function listSlackChannelConfigs(): SlackChannelConfig[] {
  return getSlackChannelStore().listConfigs();
}

/** ★로컬 설정 쓰기 — 설정 저장 + 권한 동기화. 합성 상태 반환(시크릿 미포함). */
export function setSlackChannelFromLocalSettings(
  input: SlackChannelInput,
): SlackChannelStatus {
  return getSlackChannelStore().setConfigFromLocalSettings(input);
}

/** projectId 의 합성 상태(프론트/IPC 창구 — 시크릿 미포함). */
export function getSlackChannelStatus(projectId: string): SlackChannelStatus {
  return getSlackChannelStore().getStatus(projectId);
}

/** 모든 프로젝트의 합성 상태(시크릿 미포함) — IPC list 창구. */
export function listSlackChannelStatuses(): SlackChannelStatus[] {
  const store = getSlackChannelStore();
  return store.listConfigs().map((c) => store.getStatus(c.projectId));
}

/** Socket Mode 연결을 붙여야 하는가(enabled && 프리플라이트 통과). */
export function isSlackChannelActive(projectId: string): boolean {
  return getSlackChannelStore().isActive(projectId);
}

/** 채널 설정/권한 삭제. */
export function removeSlackChannel(projectId: string): boolean {
  return getSlackChannelStore().remove(projectId);
}

/**
 * ★권한 레코드 읽기 — Slack 인바운드(slack-poller)가 인가 판정에 쓰는 read-only
 * 진입점. 쓰기 함수는 이 모듈에서 노출되지 않으므로 인바운드는 권한을 변경할 수
 * 없다(보안 불변식).
 */
export function getSlackChannelAccess(
  projectId: string,
): SlackChannelAccess | null {
  return getSlackChannelStore().getAccess(projectId);
}

/** 같은 채널로 발신하는 다른 활성 프로젝트 목록 — 발신 접두 판정용. */
export function listSlackChannelIdSharers(
  selfProjectId: string,
  channelId: string | null,
): string[] {
  return getSlackChannelStore().listChannelIdSharers(selfProjectId, channelId);
}

/** 다른 활성 프로젝트가 이 app token 을 이미 쓰는지 — 위반 projectId 목록. */
export function findSlackAppTokenConflicts(
  selfProjectId: string,
  appToken: string | null,
): string[] {
  return getSlackChannelStore().findAppTokenConflicts(selfProjectId, appToken);
}
