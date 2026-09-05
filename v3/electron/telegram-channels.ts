import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  classifyTelegramBinding,
  type TelegramBindingDecision,
  type TelegramChannelBinding,
} from "./telegram-channel-binding";

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

/** Claude Code 채널 플러그인 식별자(텔레그램). 참고용 상수 — 오케스트레이터는 더
 * 이상 `--channels` 로 이 플러그인을 물지 않는다(폴러는 electron main 이 소유,
 * ticket vw38IB2VcmOIOlFV51Wa). 플러그인 config 정리(neutralizePluginConfig)의
 * 대상 디렉토리 정체성만 문서화한다. */
export const TELEGRAM_CHANNEL_PLUGIN =
  "plugin:telegram@claude-plugins-official";

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
  /**
   * 클라우드 메타(다른 기기에서 push된 telegramChannel 필드)로부터 복원된
   * 레코드 표식. 복원 레코드는 봇 토큰이 없고 enabled=false 로 강제된다 —
   * 사용자가 로컬 설정 경로로 토큰을 다시 넣어 저장하면 해제된다.
   */
  restoredFromSync?: boolean;
}

/**
 * 기기 간 동기화되는 채널 메타 — Firestore projects/{projectId} 문서의
 * `telegramChannel` 필드에 실리는 형태. ★봇 토큰(및 그 해시)은 절대 포함하지
 * 않는다: 토큰은 기기 로컬(~/.marblo)에만 산다. hasBotToken 은 "원래 기기에는
 * 토큰이 있었다"는 사실만 전달해 새 기기 UI 가 '토큰만 다시 입력' 안내를 띄우게
 * 한다.
 */
export interface RemoteTelegramChannelMeta {
  chatId: string | null;
  enabled: boolean;
  inboundCapability: InboundCapability;
  hasBotToken: boolean;
  updatedAt: number;
  /** 이 메타를 push 한 기기의 machineId(진단용). */
  updatedByMachineId?: string;
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
  /**
   * 기기 귀속 판정(티켓 t5X4CUwr4LqbEZNRpeEZ) — "이 채널을 어느 기기가
   * 인증했는가". ★차단이 아니라 표시용이다: verdict === "foreign" 이어도
   * canEnable 은 잠그지 않는다(사용자가 여기서 켜는 것은 정당한 인수다).
   * 프론트는 이 값으로 "앞 기기가 끊깁니다" 경고를 띄운다.
   */
  deviceBinding: TelegramBindingDecision;
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

// ─── 기기 귀속 관측자 (티켓 t5X4CUwr4LqbEZNRpeEZ) ──────────────────────
//
// 귀속 사실은 Firestore projects/{id}.telegramChannelBinding 에 산다. 이 모듈은
// 로컬 파일 저장소라 firebase 를 몰라야 하므로(그리고 telegram-channel-sync 가
// 이 모듈을 import 하므로 반대 방향 import 는 순환이다), 관측자를 **주입**받는다.
// main.ts 가 부팅 시 한 번 꽂고, sync 의 pull 이 관측치를 갱신한다.

/**
 * 귀속 관측자. ★observed() 는 **던져도 된다** — 스토어가 fail-open 으로
 * 흡수한다(#1419 규율). 던지는 경우와 null 을 돌려주는 경우는 의미가 다르다:
 *   undefined — 아직 관측 못 함(부팅 직후·오프라인). 미지.
 *   null      — 원격에 귀속 필드가 없음. 기존 채널. ★절대 막지 않는다.
 */
export interface TelegramBindingObserver {
  /** 이 기기의 안정 machineId. 모르면 빈 문자열. */
  machineId(): string;
  observed(projectId: string): TelegramChannelBinding | null | undefined;
}

/** 주입된 관측자. 없으면 모든 판정이 "unknown"(=아무것도 막지 않음)이다. */
let bindingObserver: TelegramBindingObserver | null = null;

/** 관측자 주입 — main.ts 부팅 경로와 테스트가 쓴다. null 이면 해제. */
export function setTelegramBindingObserver(
  observer: TelegramBindingObserver | null,
): void {
  bindingObserver = observer;
}

// ─── 경로/저장 ────────────────────────────────────────────────────────

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".marblo");
const DEFAULT_STORE_FILE = "telegram-channels.json";
/** 권한 파일 — chmod 600 로 보호. */
const DEFAULT_ACCESS_FILE = "telegram-access.json";
/**
 * 폴러 오프셋 파일 이름 — telegram-poller 의 DEFAULT_OFFSET_FILE 과 같은 파일.
 * 스토어는 이 파일을 "이전에 이 프로젝트로 텔레그램을 쓴 흔적" 판정에만
 * 읽기 전용으로 참조한다(설정 유실을 조용히 넘기지 않기 위한 안내용).
 */
const POLLER_OFFSET_FILE = "telegram-poller-offsets.json";

/** 권한/비밀 파일 권한 — 소유자 read/write 만(0600). */
const ACCESS_FILE_MODE = 0o600;

// ─── 공식 텔레그램 플러그인 config 정리 (브릿지 제거됨) ────────────────
// 과거에는 오케를 --channels plugin:telegram 으로 띄우기 위해 마블로 봇 토큰을
// ~/.claude/channels/telegram/.env 로 실체화(materialize)했다. #301 이후 폴러는
// electron main 단독 소유가 되어 이 브릿지는 용도를 잃었는데, 실체화된 토큰은
// 남아서 역효과만 냈다: 이 머신의 **모든** claude 플러그인 호스트(Cursor MCP,
// strict 없는 인터랙티브 세션)가 그 .env 를 읽고 자체 getUpdates 폴러를 부팅해
// electron main 폴러를 409 로 강탈한다 — 그리고 받은 메시지를 배달 없이 버린다
// (티켓 kYC4pGM7S4k6967qs8uO 실측: Cursor mcp-process → bun server.ts 가 점유).
//
// 그래서 이제 이 모듈은 플러그인 config 를 **만들지 않고 치운다**: 저장/삭제/앱
// 기동 시마다 .env 의 TELEGRAM_BOT_TOKEN 을 제거하고(다른 키는 보존) access.json
// 이 있으면 dmPolicy=disabled 로 중화한다. 봇 토큰은 ~/.marblo 밖으로 나가지
// 않는다. 텔레그램 인바운드는 여전히 이 코드에 도달하지 않는다(읽기 함수만 노출).

/** 공식 플러그인이 상태를 읽는 기본 디렉토리(TELEGRAM_STATE_DIR 미설정 시). */
const DEFAULT_PLUGIN_DIR = path.join(
  os.homedir(),
  ".claude",
  "channels",
  "telegram",
);
/**
 * ★스폰된 에이전트의 격리 홈이 모여 있는 루트 (티켓 hAzP05kOTxggd8LhZGwT).
 * agent-config 의 CONFIG_DIR 과 같은 자리다. 여기 값을 import 하지 않고 다시
 * 적는 이유는 순환 의존을 만들지 않기 위해서다 — 이 모듈은 채널 저장소이고
 * 에이전트 설정을 알아서는 안 된다. 경로가 바뀌면 그때는 후보가 하나 줄 뿐,
 * 청소가 깨지지는 않는다(전부 best-effort).
 */
const DEFAULT_AGENT_HOME_ROOT = path.resolve(
  os.tmpdir(),
  "marblo-agent-configs",
);
/** 홈 디렉토리 기준 플러그인 상태 디렉토리의 상대 경로. */
const PLUGIN_DIR_UNDER_HOME = path.join(".claude", "channels", "telegram");
/** CLAUDE_CONFIG_DIR 기준 플러그인 상태 디렉토리의 상대 경로. */
const PLUGIN_DIR_UNDER_CLAUDE_CONFIG = path.join("channels", "telegram");

/**
 * ★마블로 봇 토큰이 실체화돼 있을 수 있는 **모든** 플러그인 상태 디렉토리
 * (티켓 hAzP05kOTxggd8LhZGwT).
 *
 * 지금까지 청소는 `~/.claude/channels/telegram` 한 곳만 쳤다. 그런데 공식
 * 플러그인이 실제로 읽는 자리는 그것 하나가 아니다:
 *
 *   1. `TELEGRAM_STATE_DIR` — 플러그인의 명시적 오버라이드. 이게 설정돼 있으면
 *      플러그인은 기본 경로를 아예 보지 않으므로, 기본 경로만 치우는 청소는
 *      **아무 것도 못 치운다**.
 *   2. `CLAUDE_CONFIG_DIR/channels/telegram` — claude 설정 디렉토리를 옮긴
 *      호스트(Cursor MCP 포함)가 읽는 자리.
 *   3. `$HOME/.claude/channels/telegram` — 스폰된 에이전트가 격리된 HOME 으로
 *      돌면 `os.homedir()` 와 `process.env.HOME` 이 갈라진다. 그 프로세스가
 *      부팅한 플러그인 폴러는 우리가 한 번도 본 적 없는 .env 를 쓴다.
 *   4. `os.homedir()/.claude/channels/telegram` — 기본값(기존 동작).
 *   5. 스폰 에이전트 홈 루트의 각 하위 디렉토리 밑의 같은 경로 — 마블로가
 *      직접 만든 격리 홈들.
 *
 * 순수 함수(파일시스템은 5번의 readdir 하나만, 그마저 실패는 무시). 반환은
 * 중복 제거된 절대경로이고, **첫 원소가 이 호스트가 실제로 읽을 자리**다
 * (진단 로그가 이 값을 이름으로 쓴다).
 */
export function telegramPluginStateDirCandidates(opts?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  agentHomeRoot?: string;
}): string[] {
  const env = opts?.env ?? process.env;
  const homeDir = opts?.homeDir ?? os.homedir();
  const agentHomeRoot = opts?.agentHomeRoot ?? DEFAULT_AGENT_HOME_ROOT;

  const out: string[] = [];
  const push = (dir: string | null | undefined): void => {
    if (!dir || !dir.trim()) return;
    const resolved = path.resolve(dir);
    if (!out.includes(resolved)) out.push(resolved);
  };

  // (1) 명시적 오버라이드가 있으면 그게 이 호스트의 "실제 자리"다 → 첫 원소.
  push(env.TELEGRAM_STATE_DIR);
  // (2) claude 설정 디렉토리 이동.
  if (env.CLAUDE_CONFIG_DIR?.trim()) {
    push(path.join(env.CLAUDE_CONFIG_DIR, PLUGIN_DIR_UNDER_CLAUDE_CONFIG));
  }
  // (4) 기본값 — 오버라이드가 없으면 이게 첫 원소가 된다.
  push(path.join(homeDir, PLUGIN_DIR_UNDER_HOME));
  // (3) 격리된 HOME.
  if (env.HOME?.trim()) push(path.join(env.HOME, PLUGIN_DIR_UNDER_HOME));
  // (5) 마블로가 만든 스폰 에이전트 홈들.
  try {
    for (const entry of fs.readdirSync(agentHomeRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      push(path.join(agentHomeRoot, entry.name, PLUGIN_DIR_UNDER_HOME));
    }
  } catch {
    /* 루트가 없으면 후보도 없다 — 정상. */
  }
  return out;
}
/** 플러그인 .env — TELEGRAM_BOT_TOKEN 이 사는 곳(플러그인은 없으면 exit). */
const PLUGIN_ENV_FILE = ".env";
/** 플러그인 access.json — 화이트리스트(allowFrom)/정책(dmPolicy). */
const PLUGIN_ACCESS_FILE = "access.json";
/** 플러그인 상태 디렉토리 권한 — 소유자만(0700). 플러그인 자체도 0o700 로 만든다. */
const PLUGIN_DIR_MODE = 0o700;
/** .env 안 봇 토큰 키. */
const PLUGIN_TOKEN_KEY = "TELEGRAM_BOT_TOKEN";

/**
 * 공식 플러그인 access.json 스키마(server.ts 의 Access 타입과 일치). 우리는
 * dmPolicy/allowFrom 만 소유·관리하고, 나머지 필드(groups·pending·delivery 옵션)는
 * 기존 파일이 있으면 보존한다(플러그인/skill 이 쓴 런타임 상태 클로버 방지).
 */
interface PluginAccess {
  dmPolicy: "pairing" | "allowlist" | "disabled";
  allowFrom: string[];
  groups: Record<string, unknown>;
  pending: Record<string, unknown>;
  mentionPatterns?: string[];
  ackReaction?: string;
  replyToMode?: "off" | "first" | "all";
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
}

/**
 * 플러그인 config 청소 결과. tokenRemoved 는 **어느 한 디렉토리에서라도**
 * 토큰을 지웠는지, cleanedDirs 는 실제로 지운 디렉토리 목록(진단 로그용 —
 * 어느 자리에 남아 있었는지가 곧 다음에 볼 자리다).
 */
export interface PluginNeutralizeResult {
  tokenRemoved: boolean;
  cleanedDirs: string[];
}

type StoredConfigs = Record<string, TelegramChannelConfig>;
type StoredAccess = Record<string, ChannelAccess>;

/**
 * 텔레그램 채널 설정 + 권한(access.json)의 로컬 단일 진실원. 테스트는 storeDir 을
 * 주입해 격리한다(connection-store.ts 의 storePath 주입과 동일 패턴).
 */
export class TelegramChannelStore {
  private configPath: string;
  private accessPath: string;
  /**
   * 공식 플러그인이 읽는 상태 디렉토리들(브릿지 대상). 테스트는 tmp 로 격리
   * 주입한다. ★[0] 이 이 호스트가 실제로 읽을 자리이고, 나머지는 과거 빌드나
   * 격리 HOME 으로 돈 프로세스가 토큰을 남겼을 수 있는 자리다 — 청소는 전부를
   * 친다(티켓 hAzP05kOTxggd8LhZGwT).
   */
  private pluginDirs: string[];
  /** 폴러 오프셋 파일(읽기 전용 — 과거 사용 흔적 판정용). */
  private offsetPath: string;

  constructor(opts?: {
    storeDir?: string;
    /** 단일 디렉토리 주입(기존 테스트 호환). pluginDirs 가 있으면 무시된다. */
    pluginDir?: string;
    /** ★청소 대상 디렉토리 전부. 미지정이면 이 호스트의 후보 집합을 계산한다. */
    pluginDirs?: string[];
    offsetFilePath?: string;
  }) {
    const dir = opts?.storeDir ?? DEFAULT_STORE_DIR;
    this.configPath = path.join(dir, DEFAULT_STORE_FILE);
    this.accessPath = path.join(dir, DEFAULT_ACCESS_FILE);
    this.pluginDirs =
      opts?.pluginDirs && opts.pluginDirs.length > 0
        ? [...opts.pluginDirs]
        : opts?.pluginDir
          ? [opts.pluginDir]
          : telegramPluginStateDirCandidates();
    if (this.pluginDirs.length === 0) this.pluginDirs = [DEFAULT_PLUGIN_DIR];
    this.offsetPath =
      opts?.offsetFilePath ?? path.join(dir, POLLER_OFFSET_FILE);
  }

  /** 설정 파일 절대경로(진단용). */
  getConfigPath(): string {
    return this.configPath;
  }
  /** 권한 파일 절대경로(진단용). */
  getAccessPath(): string {
    return this.accessPath;
  }
  /** 이 호스트가 실제로 읽을 플러그인 상태 디렉토리(진단용). */
  getPluginDir(): string {
    return this.pluginDirs[0];
  }
  /** ★청소가 치는 모든 플러그인 상태 디렉토리(진단용). */
  getPluginDirs(): string[] {
    return [...this.pluginDirs];
  }
  /** 플러그인 .env 절대경로(진단용 — 주 디렉토리 기준). */
  getPluginEnvPath(): string {
    return path.join(this.pluginDirs[0], PLUGIN_ENV_FILE);
  }
  /** 플러그인 access.json 절대경로(진단용 — 주 디렉토리 기준). */
  getPluginAccessPath(): string {
    return path.join(this.pluginDirs[0], PLUGIN_ACCESS_FILE);
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
   * 이 프로젝트의 기기 귀속 판정 (티켓 t5X4CUwr4LqbEZNRpeEZ).
   *
   * ★★이 try/catch 가 이 티켓의 fail-open 지점이다 (#1419 규율 계승).
   * 관측자가 없거나(부팅 직후) 던지면(오프라인·권한·Firestore 장애) 판정은
   * "unknown" 이고 **아무것도 막지 않는다**. 귀속 검사 때문에 텔레그램이
   * 영영 죽는 경로는 지금(겹쳐서 절반 유실)보다 명백히 나쁘다.
   * 이 catch 를 지우면 tests/unit/telegram-channel-binding.test.ts 의
   * fail-open 테스트가 깨진다 — 그게 이 줄이 있는 이유다.
   */
  classifyBinding(
    projectId: string,
    botToken: string | null,
  ): TelegramBindingDecision {
    try {
      if (!bindingObserver) {
        return {
          verdict: "unknown",
          binding: null,
          autoEnableAllowed: true,
          failOpenReason: "no device-binding observer installed",
          notice: null,
        };
      }
      return classifyTelegramBinding(
        bindingObserver.observed(projectId),
        bindingObserver.machineId(),
        botToken,
      );
    } catch (err) {
      return {
        verdict: "unknown",
        binding: null,
        autoEnableAllowed: true,
        failOpenReason: `device binding check failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        notice: null,
      };
    }
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
    // ★토큰 소유권 규칙(1 봇 = 1 프로젝트): getUpdates 는 봇당 단일 소비자라
    // 같은 토큰으로 두 프로젝트가 활성이면 두 폴 루프가 서로를 409 로 강탈한다.
    // 다른 활성 프로젝트가 이미 이 토큰을 쓰고 있으면 활성화를 강등 차단한다.
    const tokenConflicts = this.findTokenConflicts(input.projectId, botToken);
    // ★기기 귀속 규칙(티켓 t5X4CUwr4LqbEZNRpeEZ) — **자동 계승만** 막는다.
    //
    // 다른 기기가 인증한 채널(verdict==="foreign")은 사용자가 여기서 손대지
    // 않은 상태로 *저절로* 켜지면 안 된다. 그게 오늘 사고의 구조다: 두 맥이
    // 같은 봇을 enabled=true 로 물고 서로를 409 로 강탈했다.
    //
    // 그러나 사용자가 이 기기에서 **명시적으로** 켜는 것(input.enabled===true)은
    // 막지 않는다 — 그건 정당한 인수이고, 그 대가(앞 기기가 끊긴다)는
    // getStatus 의 안내문이 미리 말한다. 여기서 막아버리면 기기를 갈아탄
    // 사용자가 영영 못 켜는 상태가 생기고, 그건 지금보다 나쁘다.
    const bindingDecision = this.classifyBinding(input.projectId, botToken);
    const inheritedEnable =
      input.enabled === undefined && (existing?.enabled ?? false);
    const bindingBlocksInherited =
      inheritedEnable && !bindingDecision.autoEnableAllowed;
    // chatId/토큰 유효하지 않거나 토큰이 다른 활성 프로젝트와 겹치거나 남의 기기
    // 귀속을 조용히 물려받는 경우 활성 불가 — 요청과 무관하게 강등(방어선).
    const enabled =
      requestedEnabled &&
      preflight.ok &&
      !tokenConflicts.length &&
      !bindingBlocksInherited;

    const merged: TelegramChannelConfig = {
      projectId: input.projectId,
      botToken,
      chatId,
      enabled,
      inboundCapability,
      updatedAt: now(),
      // 복원 표식은 토큰이 다시 채워지는 순간 해제된다 — 그 전까지는 유지해
      // "토큰만 다시 입력하세요" 안내(getStatus issues)가 계속 뜨게 한다.
      ...(existing?.restoredFromSync && !botToken
        ? { restoredFromSync: true }
        : {}),
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

    // 공식 플러그인 config(~/.claude/channels/telegram)에 토큰이 실체화되어
    // 있으면 치운다(브릿지 제거 — 모듈 상단 주석 참고). 멱등.
    this.neutralizePluginConfig();

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
    // 플러그인 config 도 정리(토큰 제거·access 중화).
    this.neutralizePluginConfig();
    return had;
  }

  // ── 기기 간 동기화 (클라우드 메타 ← / →) ──────────────────────────

  /**
   * 로컬 설정을 기기 간 동기화용 메타로 투영한다(push 용). ★토큰은 어떤
   * 형태(원문·해시)로도 싣지 않는다 — hasBotToken 불리언만.
   */
  buildRemoteMeta(
    projectId: string,
    machineId?: string,
  ): RemoteTelegramChannelMeta | null {
    const cfg = this.getConfig(projectId);
    if (!cfg) return null;
    return {
      chatId: cfg.chatId,
      enabled: cfg.enabled,
      inboundCapability: cfg.inboundCapability,
      hasBotToken: !!cfg.botToken,
      updatedAt: cfg.updatedAt,
      ...(machineId ? { updatedByMachineId: machineId } : {}),
    };
  }

  /**
   * 다른 기기가 push 한 클라우드 메타를 이 기기에 materialize 한다(pull 용).
   *
   * ★보안 경계 — 원격 데이터는 이 기기의 어떤 것도 활성화하지 못한다:
   *   - **로컬 레코드가 없는 프로젝트만** 생성한다. 로컬 레코드가 있으면(=이
   *     기기가 토큰을 쥔 권위자이거나 이미 복원됨) 원격 메타를 채택하지 않는다
   *     — 프로젝트 문서를 쓸 수 있는 타 멤버가 내 기기의 chatId/enabled 를
   *     원격에서 바꿔치기하는 경로를 차단.
   *   - 생성 레코드는 botToken=null·enabled=false 강제 + restoredFromSync 표식.
   *     활성화는 사용자가 로컬 설정 경로(setConfigFromLocalSettings)로 토큰을
   *     재입력·저장해야만 가능하다.
   *   - access.json(권한 파일)은 절대 건드리지 않는다 — 그 파일의 유일한 쓰기
   *     경로는 여전히 가드된 로컬 설정 경로뿐이다.
   *
   * 반환: 실제로 레코드를 만들었으면 true.
   */
  applyRemoteMeta(projectId: string, meta: RemoteTelegramChannelMeta): boolean {
    if (!projectId || this.getConfig(projectId)) return false;
    const chatId = normalizeId(meta.chatId ?? null);
    // chatId 도 hasBotToken 흔적도 없는 빈 메타는 복원할 게 없다.
    if (!chatId && !meta.hasBotToken) return false;
    const all = this.readConfigs();
    all[projectId] = {
      projectId,
      botToken: null,
      chatId,
      enabled: false,
      inboundCapability: meta.inboundCapability === "read" ? "read" : "trigger",
      updatedAt: now(),
      restoredFromSync: true,
    };
    this.writeConfigs(all);
    return true;
  }

  /**
   * 같은 chatId 로 발신하도록 설정된 **다른 활성(enabled) 프로젝트** 목록.
   * 한 대화방에 여러 프로젝트 응답이 섞이는 상황의 판정 근거 — 등록 단계
   * 경고(getStatus issues)와 발신 접두([프로젝트]) 부착이 이걸 쓴다.
   * 차단이 아니라 구분 수단인 이유: 개인 chatId 하나로 여러 프로젝트 봇을
   * 받는 것은 합법 사용 패턴이다(현행 라이브 채널 3개가 실제 그 형태).
   */
  listChatIdSharers(selfProjectId: string, chatId: string | null): string[] {
    const chat = normalizeId(chatId);
    if (!chat) return [];
    return Object.values(this.readConfigs())
      .filter(
        (c) => c.projectId !== selfProjectId && c.enabled && c.chatId === chat,
      )
      .map((c) => c.projectId)
      .sort();
  }

  /**
   * 이 프로젝트로 텔레그램을 쓴 과거 흔적(폴러 오프셋 기록)이 있는가 —
   * 채널 설정이 없는데 흔적만 남은 상태는 "기기 변경/유실"의 강한 신호라
   * getStatus 가 명시적 안내 issue 를 띄우는 데 쓴다. 읽기 전용·절대 throw 안 함.
   */
  hasPollerTrace(projectId: string): boolean {
    const offsets = readJsonMap<unknown>(this.offsetPath);
    return projectId in offsets;
  }

  // ── 상태/프리플라이트 ─────────────────────────────────────────────

  /** projectId 의 합성 상태(프론트 토글 잠금/표시용). 레코드 없으면 빈 상태. */
  getStatus(projectId: string): ChannelStatus {
    const cfg = this.getConfig(projectId);
    const preflight = preflightChannel({
      botToken: cfg?.botToken ?? null,
      chatId: cfg?.chatId ?? null,
    });
    // 토큰 소유권 규칙(1 봇 = 1 프로젝트) 위반은 issues 로 표시하고 토글을
    // 잠근다(canEnable=false). active 는 건드리지 않는다 — 레거시로 이미 두
    // 프로젝트가 활성인 경우 승자 선정은 폴러의 토큰 dedup 이 담당한다.
    const conflicts = this.findTokenConflicts(projectId, cfg?.botToken ?? null);
    if (conflicts.length > 0) {
      preflight.issues.push(
        `이 봇 토큰은 이미 다른 프로젝트(${conflicts.join(", ")})의 활성 채널이 ` +
          `사용 중입니다. 텔레그램 getUpdates 는 봇당 1개 소비자만 허용하므로 ` +
          `프로젝트마다 별도의 봇을 만들어 연결하세요.`,
      );
    }
    // 기기 변경 복원 안내: 다른 기기의 클라우드 메타에서 복원된 레코드는 봇
    // 토큰이 없다(보안상 토큰은 동기화되지 않음). 무엇을 다시 넣어야 하는지
    // 명시한다 — 비차단 정보성 issue (canEnable 은 preflight 가 이미 잠금).
    if (cfg?.restoredFromSync && !cfg.botToken) {
      preflight.issues.push(
        "다른 기기에서 쓰던 채널 설정을 복원했습니다. 보안상 봇 토큰은 기기 간 " +
          "동기화되지 않으니, BotFather 의 봇 토큰만 다시 입력하고 저장한 뒤 " +
          "활성화하면 채널이 복구됩니다.",
      );
    }
    // 설정 유실 안내: 레코드는 없는데 과거 폴러 오프셋 흔적이 남아 있으면
    // "잘 쓰다가 끊긴" 상태다 — 조용히 넘기지 않고 명시적으로 알린다.
    if (!cfg && this.hasPollerTrace(projectId)) {
      preflight.issues.push(
        "이 프로젝트에서 텔레그램 채널을 사용한 흔적(수신 기록)이 있지만 채널 " +
          "설정이 없습니다. 기기 변경 등으로 설정이 유실됐을 수 있습니다 — " +
          "봇 토큰과 chatId 를 다시 등록하면 알림이 복구됩니다.",
      );
    }
    // chatId 공유 안내: 같은 대화방으로 발신하는 다른 활성 프로젝트가 있으면
    // 응답이 섞인다. 차단하지 않고(합법 패턴·무회귀) 구분 수단을 알린다 —
    // 실제 발신 시 폴러가 [프로젝트] 접두를 자동 부착한다.
    const chatSharers = this.listChatIdSharers(projectId, cfg?.chatId ?? null);
    if (chatSharers.length > 0) {
      preflight.issues.push(
        `이 chatId 는 다른 프로젝트(${chatSharers.join(", ")})의 활성 채널도 ` +
          `사용 중입니다. 같은 대화방에 여러 프로젝트의 응답이 도착하므로, ` +
          `구분을 위해 발신 메시지에 [프로젝트명] 접두가 자동으로 붙습니다.`,
      );
    }
    // ★기기 귀속 안내(티켓 t5X4CUwr4LqbEZNRpeEZ): 다른 기기가 인증한 채널이면
    // 그 사실과 대가를 함께 띄운다 — 봇당 수신자는 하나뿐이라 여기서 켜는 것은
    // 곧 앞 기기의 수신을 끊는 일이다. 사용자가 모르고 뺏는 일이 없게.
    //
    // ★비차단이다: canEnable 을 잠그지 않는다. 이건 표시와 탐지의 층이고,
    // 실제로 다른 맥이 api.telegram.org 를 직접 부르는 것은 우리가 막을 수
    // 있는 경로가 아니다(telegram-channel-binding.ts 상단 경계 설명 참고).
    const deviceBinding = this.classifyBinding(
      projectId,
      cfg?.botToken ?? null,
    );
    if (deviceBinding.notice) preflight.issues.push(deviceBinding.notice);
    return {
      projectId,
      enabled: cfg?.enabled ?? false,
      hasBotToken: preflight.hasBotToken,
      hasChatId: preflight.hasChatId,
      preflight,
      canEnable: preflight.ok && conflicts.length === 0,
      active: (cfg?.enabled ?? false) && preflight.ok,
      deviceBinding,
    };
  }

  /**
   * 이 프로젝트가 아닌 다른 **활성(enabled)** 프로젝트 중 같은 봇 토큰을 쓰는
   * projectId 목록. getUpdates 는 봇당 단일 소비자라 이 목록이 비어야만 활성화
   * 가능하다(1 봇 = 1 프로젝트 규칙).
   */
  findTokenConflicts(selfProjectId: string, botToken: string | null): string[] {
    const token = normalizeSecret(botToken);
    if (!token) return [];
    return Object.values(this.readConfigs())
      .filter(
        (c) =>
          c.projectId !== selfProjectId && c.enabled && c.botToken === token,
      )
      .map((c) => c.projectId)
      .sort();
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

  // ── 공식 플러그인 config 정리 (~/.claude/channels/telegram) ──────────

  /**
   * 플러그인 상태 디렉토리에 실체화된 마블로 봇 토큰을 치운다(브릿지 제거 —
   * 모듈 상단 주석 참고).
   *   - .env 의 TELEGRAM_BOT_TOKEN 을 제거한다. 다른 env 키가 남으면 토큰만
   *     지우고 재기록, 아니면 파일 삭제. 파일이 없으면 no-op.
   *   - access.json 이 있으면 dmPolicy='disabled'·allowFrom=[] 로 중화하고
   *     소유하지 않는 필드(groups·pending·delivery 옵션)는 보존한다. 없으면
   *     새로 만들지 않는다.
   * 멱등. 반환값 tokenRemoved 는 이번 호출이 실제로 토큰을 지웠는지 — 호출자
   * (폴러 기동 정리)가 "잔존 토큰을 발견·제거했다"를 로그로 알리는 데 쓴다.
   */
  neutralizePluginConfig(): PluginNeutralizeResult {
    let tokenRemoved = false;
    const cleanedDirs: string[] = [];
    // ★후보 디렉토리 **전부**를 친다(티켓 hAzP05kOTxggd8LhZGwT). 하나만
    // 치우던 시절에는 TELEGRAM_STATE_DIR 오버라이드나 격리 HOME 밑에 남은
    // 토큰이 그대로 살아서, 그 토큰으로 부팅한 외부 플러그인 폴러가 우리를
    // 계속 409 로 강탈할 수 있었다. 각 디렉토리는 독립적으로 best-effort —
    // 하나가 실패해도 나머지 청소는 계속한다.
    for (const dir of this.pluginDirs) {
      let dirCleaned = false;
      try {
        const envPath = path.join(dir, PLUGIN_ENV_FILE);
        const parsed = readEnvFile(envPath);
        if (parsed !== null && PLUGIN_TOKEN_KEY in parsed) {
          tokenRemoved = true;
          dirCleaned = true;
          delete parsed[PLUGIN_TOKEN_KEY];
          if (Object.keys(parsed).length > 0) {
            atomicWriteText(envPath, serializeEnv(parsed), ACCESS_FILE_MODE);
          } else {
            try {
              fs.unlinkSync(envPath);
            } catch {
              // 이미 없으면 무시.
            }
          }
        }
        // access.json 은 이미 존재할 때만 중화(없으면 새로 만들지 않는다).
        const accessPath = path.join(dir, PLUGIN_ACCESS_FILE);
        const existing = readPluginAccessFile(accessPath);
        if (
          existing !== null &&
          (existing.dmPolicy !== "disabled" || existing.allowFrom.length > 0)
        ) {
          const neutralized: PluginAccess = {
            ...existing,
            dmPolicy: "disabled",
            allowFrom: [],
          };
          atomicWriteJson(accessPath, neutralized, ACCESS_FILE_MODE);
        }
      } catch {
        /* 한 디렉토리의 실패가 나머지 청소를 막지 않는다. */
      }
      if (dirCleaned) cleanedDirs.push(dir);
    }
    return { tokenRemoved, cleanedDirs };
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

/**
 * 텍스트 파일을 tmp→rename 으로 원자 기록(atomicWriteJson 의 텍스트 버전).
 * .env(비밀 토큰 포함)를 0600 으로 기록하는 데 쓴다. tmp 도 같은 mode 로 생성.
 */
function atomicWriteText(
  filePath: string,
  content: string,
  mode: number,
): void {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
    mode: PLUGIN_DIR_MODE,
  });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: "utf-8", mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, mode);
}

/**
 * .env 를 key→value 맵으로 읽는다(플러그인 로더와 동일한 `^(\w+)=(.*)$` 규칙).
 * 파일이 없으면 null(존재 여부를 구분해 정리 로직이 판단하도록). 깨진 라인은 건너뛴다.
 */
function readEnvFile(filePath: string): Record<string, string> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** key→value 맵을 .env 텍스트로 직렬화(줄바꿈 종료). */
function serializeEnv(env: Record<string, string>): string {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  return lines.length ? lines.join("\n") + "\n" : "";
}

/**
 * 플러그인 access.json 을 읽어 PluginAccess 로 정규화한다. 파일 없음/깨짐이면 null
 * (없을 때만 신규 생성을 스킵하려고 존재 여부를 구분). 절대 throw 안 함.
 */
function readPluginAccessFile(filePath: string): PluginAccess | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PluginAccess>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return {
      dmPolicy: parsed.dmPolicy ?? "pairing",
      allowFrom: Array.isArray(parsed.allowFrom) ? parsed.allowFrom : [],
      groups:
        parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {},
      pending:
        parsed.pending && typeof parsed.pending === "object"
          ? parsed.pending
          : {},
      ...(parsed.mentionPatterns !== undefined
        ? { mentionPatterns: parsed.mentionPatterns }
        : {}),
      ...(parsed.ackReaction !== undefined
        ? { ackReaction: parsed.ackReaction }
        : {}),
      ...(parsed.replyToMode !== undefined
        ? { replyToMode: parsed.replyToMode }
        : {}),
      ...(parsed.textChunkLimit !== undefined
        ? { textChunkLimit: parsed.textChunkLimit }
        : {}),
      ...(parsed.chunkMode !== undefined
        ? { chunkMode: parsed.chunkMode }
        : {}),
    };
  } catch {
    // 깨진 JSON 은 플러그인이 알아서 corrupt 처리(백업 후 리셋)하므로 우리는
    // 건드리지 않는다 — null 로 취급해 소유 필드만 새로 쓰는 대신 스킵.
    return null;
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
 * 플러그인 상태 디렉토리(~/.claude/channels/telegram)에 실체화된 마블로 봇
 * 토큰을 치운다(브릿지 제거 — 모듈 상단 주석 참고). telegram-poller 가 기동 시
 * 호출해 과거 빌드가 남긴 토큰을 정리한다 — 외부 claude/Cursor 플러그인 폴러가
 * 우리 토큰으로 부팅해 getUpdates 를 409 강탈하는 경로를 원천 차단.
 */
export function neutralizeTelegramPluginConfig(): PluginNeutralizeResult {
  return getTelegramChannelStore().neutralizePluginConfig();
}

/**
 * 클라우드 메타를 이 기기에 materialize(pull). 로컬 레코드가 없는 프로젝트만
 * 생성하며 enabled=false 강제 — 자세한 보안 경계는 applyRemoteMeta 주석 참고.
 */
export function applyRemoteTelegramChannelMeta(
  projectId: string,
  meta: RemoteTelegramChannelMeta,
): boolean {
  return getTelegramChannelStore().applyRemoteMeta(projectId, meta);
}

/** 로컬 설정의 동기화용 투영(push). 토큰 미포함 보장. 레코드 없으면 null. */
export function buildRemoteTelegramChannelMeta(
  projectId: string,
  machineId?: string,
): RemoteTelegramChannelMeta | null {
  return getTelegramChannelStore().buildRemoteMeta(projectId, machineId);
}

/**
 * 이 프로젝트의 기기 귀속 판정 — telegram-channel-sync 의 push 가
 * "내가 인수해서 귀속을 다시 써야 하는가"를 정할 때 쓴다.
 * ★절대 throw 하지 않는다(스토어가 fail-open 으로 흡수).
 */
export function classifyTelegramChannelBinding(
  projectId: string,
  botToken: string | null,
): TelegramBindingDecision {
  return getTelegramChannelStore().classifyBinding(projectId, botToken);
}

/**
 * 같은 chatId 로 발신하는 다른 활성 프로젝트 목록 — 발신 접두([프로젝트])
 * 부착 판정에 telegram-poller 가 사용한다.
 */
export function listTelegramChatIdSharers(
  selfProjectId: string,
  chatId: string | null,
): string[] {
  return getTelegramChannelStore().listChatIdSharers(selfProjectId, chatId);
}

/**
 * 다른 활성 프로젝트가 이 토큰을 이미 쓰는지(1 봇 = 1 프로젝트 규칙 위반) —
 * 위반 projectId 목록. telegram-poller 의 409 진단이 사용한다.
 */
export function findTelegramTokenConflicts(
  selfProjectId: string,
  botToken: string | null,
): string[] {
  return getTelegramChannelStore().findTokenConflicts(selfProjectId, botToken);
}

/** 플러그인 상태 디렉토리 절대경로(기본 store 기준) — 폴러 409 진단용. */
export function getTelegramPluginStateDir(): string {
  return getTelegramChannelStore().getPluginDir();
}

/** ★청소·진단이 보는 모든 플러그인 상태 디렉토리(기본 store 기준). */
export function getTelegramPluginStateDirs(): string[] {
  return getTelegramChannelStore().getPluginDirs();
}
