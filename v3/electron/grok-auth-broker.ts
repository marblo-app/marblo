/**
 * Grok 크레덴셜 브로커 — 격리 GROK_HOME 이 사용자 로그인을 죽이지 못하게 한다.
 *
 * ★왜 이 모듈이 존재하는가 (grok 자체 로그 실측, 2026-08-10)
 *
 * 종전 배선은 에이전트별 격리홈의 `auth.json` 을 사용자 `~/.grok/auth.json` 로
 * **심볼릭 링크**했다. 읽기 공유만 될 거라 봤지만, grok 은 그 파일을 **가변
 * 크레덴셜 스토어**로 다룬다: 심링크를 realpath 로 풀어 잠그고(lock 도 실파일
 * 옆에 만든다) 쓰고, refresh 가 영구실패하면 **지운다**.
 *
 *   resolved_path=/Users/<me>/.grok/auth.json        ← 격리홈인데 실파일로 해석
 *   auth lock path=/Users/<me>/.grok/auth.json.lock
 *   oidc try_refresh_pure terminal error :: invalid_grant
 *   auth.refresh.permanent_failure :: RefreshTokenRejected
 *   auth: cleared credentials ... disk_mutation="file deleted (no scopes left)"
 *   auth disk state: entry lost :: Ok → FileMissing
 *
 * 즉 **에이전트 하나의 refresh 실패가 머신 전체 로그인을 삭제**했다. 사용자 홈
 * 로그에만 2주간 동일 삭제가 6회, 격리홈 로그에도 5건+ 찍혔다. 그래서 grok 은
 * 반복적으로 "not authenticated" 로 빠졌고 매번 사람이 `grok login` 을 다시 했다.
 *
 * 삭제를 "가끔"이 아니라 "자주" 만든 조력 요인: refresh token 은 회전형인데 N개
 * grok 프로세스가 **같은 RT 하나**를 공유했다. 먼저 refresh 한 놈이 회전시키면
 * 나머지는 소비된 RT 를 들고 있다가 invalid_grant → permanent_failure → 삭제.
 *
 * ★설계 (grok 문서가 보증하는 계약 위에 세운다)
 *
 *  1. **복사본, 심링크 아님.** 각 격리홈은 자기만의 사설 사본(0600)을 갖는다.
 *     에이전트가 자기 사본을 지워도 사용자 파일은 무사하다. 이것이 근본 수리다.
 *
 *  2. **write-back.** grok 이 refresh 에 성공하면 자기 홈의 사본이 갱신된다.
 *     그 사본이 사용자 파일보다 **`expires_at` 이 더 나중일 때만** 사용자 파일로
 *     원자적으로 발행한다. 회전으로 사용자 쪽 RT 가 소비돼도 공유 크레덴셜이
 *     최신으로 유지돼 다음 스폰이 살아난다. 문서 `## Hot Reload` 가 "외부에서
 *     파일을 갱신하면 재시작 없이 다음 API 호출에 반영된다"고 계약을 명시한다.
 *
 *  3. **삭제는 절대 전파하지 않는다.** 에이전트 사본이 사라지는 것은 그 에이전트
 *     세션이 죽었다는 뜻이지 사용자가 로그아웃했다는 뜻이 아니다. 브로커는 오직
 *     **더 새 크레덴셜을 쓰기만** 하고 원본을 지우거나 비우지 않는다.
 *
 * 크레덴셜 파일 스키마(실측, 값은 절대 로그로 내보내지 않는다):
 *   { "<issuer>::<client_id>": { key, refresh_token, expires_at, auth_mode, ... } }
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** auth.json 의 스코프 한 칸. 우리가 의미를 아는 필드만 좁게 선언한다. */
export interface GrokCredentialEntry {
  /** access token. 존재/비어있지 않음만 본다 — 값은 읽지도 찍지도 않는다. */
  key?: unknown;
  refresh_token?: unknown;
  /** ISO8601. 신선도 비교의 유일한 축. */
  expires_at?: unknown;
  [field: string]: unknown;
}

/** auth.json 전체 — 스코프 키 → 엔트리. */
export type GrokCredentialFile = Record<string, GrokCredentialEntry>;

/**
 * auth.json 본문을 파싱한다. 크레덴셜로 쓸 수 없는 모양이면 null.
 *
 * grok 이 "no scopes left" 로 빈 객체를 남기는 경우가 있어 **스코프가 하나도
 * 없으면 실패로 본다** — 빈 껍데기를 사용자 파일로 발행하면 그게 곧 로그아웃이다.
 */
export function parseGrokCredentials(raw: string): GrokCredentialFile | null {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const file = parsed as GrokCredentialFile;
  const scopes = Object.keys(file);
  if (scopes.length === 0) return null;
  for (const scope of scopes) {
    const entry = file[scope];
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return null;
  }
  return file;
}

/**
 * 실제로 인증에 쓸 수 있는 크레덴셜인가 — 비어있지 않은 access token(`key`)을 가진
 * 스코프가 최소 하나.
 */
export function isUsableGrokCredential(cred: GrokCredentialFile): boolean {
  return Object.values(cred).some(
    (entry) => typeof entry.key === "string" && entry.key.length > 0
  );
}

/**
 * 크레덴셜의 신선도 = 스코프들 중 **가장 나중인** `expires_at`(epoch ms).
 * 파싱 가능한 만료가 하나도 없으면 null.
 */
export function grokCredentialExpiryMs(
  cred: GrokCredentialFile
): number | null {
  let newest: number | null = null;
  for (const entry of Object.values(cred)) {
    if (typeof entry.expires_at !== "string") continue;
    const ms = Date.parse(entry.expires_at);
    if (Number.isNaN(ms)) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

/**
 * 후보(에이전트 홈의 사본)를 사용자 파일로 발행해야 하는가.
 *
 * 규칙 — 보수적으로, **의심스러우면 발행하지 않는다**:
 *  - 후보가 파싱 불가/스코프 없음/토큰 없음 → 발행 안 함(로그아웃 전파 금지).
 *  - 원본이 없거나 못 읽음 → 발행함(에이전트가 유일한 생존 크레덴셜이다).
 *  - 내용이 같으면 → 발행 안 함(무의미한 쓰기로 hot-reload 를 흔들지 않는다).
 *  - 둘 다 만료값이 있으면 → **후보가 더 나중일 때만** 발행.
 *  - 후보에 만료값이 없으면 → 발행 안 함(더 새롭다는 근거가 없다).
 */
export function shouldPublishGrokCredential(
  candidateRaw: string,
  currentRaw: string | null
): boolean {
  const candidate = parseGrokCredentials(candidateRaw);
  if (!candidate || !isUsableGrokCredential(candidate)) return false;

  if (currentRaw === null) return true;
  const current = parseGrokCredentials(currentRaw);
  if (!current || !isUsableGrokCredential(current)) return true;

  if (candidateRaw === currentRaw) return false;

  const candidateExpiry = grokCredentialExpiryMs(candidate);
  if (candidateExpiry === null) return false;
  const currentExpiry = grokCredentialExpiryMs(current);
  if (currentExpiry === null) return true;
  return candidateExpiry > currentExpiry;
}

/**
 * 크레덴셜 파일을 **원자적으로** 0600 으로 쓴다.
 *
 * 원자성이 필수인 이유: grok 은 이 경로를 재시작 없이 다시 읽는다(Hot Reload).
 * 부분적으로 쓰인 파일을 읽으면 파싱 실패 → 인증 없음으로 오판한다. 같은 디렉터리에
 * 임시파일로 쓰고 rename 하면 독자는 옛 파일 아니면 새 파일만 본다.
 */
export function writeGrokCredentialFile(target: string, raw: string): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.auth.json.marblo-${process.pid}-${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tmp, raw, { encoding: "utf-8", mode: 0o600 });
    // 기존 경로가 심링크면 rename 이 링크를 **대체**한다 — 실파일로 새는 것을
    // 막는 것이 바로 이 모듈의 목적이므로 이 대체가 정확히 원하는 동작이다.
    fs.renameSync(tmp, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // best-effort
    }
    throw error;
  }
}

/** 읽기 실패를 null 로 접는 헬퍼. */
function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 사용자 크레덴셜을 격리홈으로 **복사**한다(심링크 금지).
 *
 * @returns 복사했으면 true. 원본이 없거나 못 쓸 모양이면 false — 이때 grok 은
 *          자기 로그인 flow 로 떨어진다(깨진 토큰을 물려주는 것보다 낫다).
 */
export function installGrokCredentialCopy(
  sourceAuth: string,
  targetAuth: string
): boolean {
  const raw = readIfPresent(sourceAuth);
  if (raw === null) return false;
  const cred = parseGrokCredentials(raw);
  if (!cred || !isUsableGrokCredential(cred)) return false;

  try {
    writeGrokCredentialFile(targetAuth, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * 레거시 심링크 제거 — 종전 배선이 남긴 지뢰밭을 치운다.
 *
 * 실측: 격리홈 3827개 중 2279개의 `auth.json` 이 사용자 실파일을 겨냥한 **살아있는
 * 심링크**였다. 그 홈 중 하나라도 다시 grok 에 물리면 같은 삭제가 재발한다.
 *
 * ★심링크만 unlink 한다 — 홈 디렉터리도, 세션 기록도, 실파일도 건드리지 않는다.
 * 다음 실행 때 복사본으로 재생성되므로 기능 손실이 없다.
 *
 * @returns 해제한 심링크 수.
 */
export function unlinkLegacyGrokAuthSymlinks(configDir: string): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(configDir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith("grok-home-")) continue;
    const authPath = path.join(configDir, entry, "auth.json");
    try {
      if (!fs.lstatSync(authPath).isSymbolicLink()) continue;
      fs.unlinkSync(authPath);
      removed++;
    } catch {
      // 없거나 못 지우면 그냥 넘어간다 — 청소는 best-effort 다.
    }
  }
  return removed;
}

/** 브로커가 추적하는 에이전트 한 명. */
interface WatchedHome {
  agentId: string;
  targetAuth: string;
  /** 이 에이전트의 갱신본을 되돌려 발행할 사용자 크레덴셜 경로. */
  sourceAuth: string;
  /** 우리가 마지막으로 알고 있는 사본 내용. 변화 감지의 기준선. */
  lastSeen: string | null;
}

/**
 * 격리홈들의 크레덴셜 갱신을 사용자 파일로 되돌려주는 브로커.
 *
 * 폴링(watchFile)을 쓴다 — grok 은 auth.json 을 **교체(rename)** 하므로 inode 를
 * 잡는 `fs.watch` 는 첫 교체 후 조용히 먹통이 된다. stat 폴링은 교체를 놓치지 않는다.
 */
export class GrokAuthBroker {
  private watched = new Map<string, WatchedHome>();
  private readonly pollIntervalMs: number;
  private readonly sourceAuthOverride?: string;

  constructor(options?: { sourceAuth?: string; pollIntervalMs?: number }) {
    this.sourceAuthOverride = options?.sourceAuth;
    this.pollIntervalMs = options?.pollIntervalMs ?? 3000;
  }

  /**
   * 이 브로커가 지키는 사용자 크레덴셜 경로.
   *
   * ★홈 경로는 **호출 시점에** 푼다. 모듈 로드 때 한 번 굳히면 공용 싱글턴이
   * import 순간의 HOME 에 박혀버려, 이후 홈이 달라지는 경로(테스트의 homedir
   * 모킹, 홈을 갈아끼우는 실행)에서 엉뚱한 파일을 원본으로 삼는다.
   */
  private get sourceAuth(): string {
    return (
      this.sourceAuthOverride ?? path.join(os.homedir(), ".grok", "auth.json")
    );
  }

  /** 이 브로커가 지키는 사용자 크레덴셜 경로. */
  get sourcePath(): string {
    return this.sourceAuth;
  }

  /**
   * 에이전트 격리홈에 사설 사본을 깔고 write-back 감시를 시작한다.
   *
   * @param sourceAuth 사용자 크레덴셜 경로. 호출자가 이미 홈을 풀었으면 그대로
   *                   넘긴다 — 홈 해석이 두 군데서 갈리지 않게 한다.
   * @returns 사본을 깔았으면 true.
   */
  install(agentId: string, grokHome: string, sourceAuth?: string): boolean {
    const source = sourceAuth ?? this.sourceAuth;
    const targetAuth = path.join(grokHome, "auth.json");
    // 종전 실행이 남긴 심링크가 있으면 반드시 먼저 없앤다 — 남아 있으면 이어지는
    // 쓰기가 사용자 실파일로 새고, 그것이 정확히 이 버그였다.
    try {
      if (fs.lstatSync(targetAuth).isSymbolicLink()) {
        fs.unlinkSync(targetAuth);
      }
    } catch {
      // 없으면 할 일 없음.
    }

    const installed = installGrokCredentialCopy(source, targetAuth);
    this.watch(agentId, targetAuth, source);
    return installed;
  }

  /** 감시 해제(에이전트 종료·정리 시). */
  release(agentId: string): void {
    const entry = this.watched.get(agentId);
    if (!entry) return;
    try {
      fs.unwatchFile(entry.targetAuth);
    } catch {
      // best-effort
    }
    this.watched.delete(agentId);
  }

  /** 전체 해제(앱 종료). */
  releaseAll(): void {
    for (const agentId of Array.from(this.watched.keys())) {
      this.release(agentId);
    }
  }

  /**
   * 사본이 바뀌었는지 한 번 검사하고, 더 새 크레덴셜이면 사용자 파일로 발행한다.
   * 테스트가 타이머 없이 직접 부를 수 있도록 공개한다.
   *
   * @returns 발행했으면 true.
   */
  syncOnce(agentId: string): boolean {
    const entry = this.watched.get(agentId);
    if (!entry) return false;

    const candidateRaw = readIfPresent(entry.targetAuth);
    if (candidateRaw === null) {
      // 사본이 사라졌다 = 이 에이전트의 grok 이 permanent_failure 로 자기 것을
      // 지웠다. ★사용자 파일에는 손대지 않는다 — 이 전파가 바로 원래 버그였다.
      entry.lastSeen = null;
      return false;
    }
    if (candidateRaw === entry.lastSeen) return false;
    entry.lastSeen = candidateRaw;

    const currentRaw = readIfPresent(entry.sourceAuth);
    if (!shouldPublishGrokCredential(candidateRaw, currentRaw)) return false;

    try {
      writeGrokCredentialFile(entry.sourceAuth, candidateRaw);
      console.log(
        `[GrokAuthBroker] Published refreshed credential from agent ${agentId} to the shared grok login`
      );
      return true;
    } catch (error) {
      console.warn(
        `[GrokAuthBroker] Failed to publish refreshed credential for agent ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  private watch(agentId: string, targetAuth: string, sourceAuth: string): void {
    const existing = this.watched.get(agentId);
    if (existing) {
      if (existing.targetAuth === targetAuth) {
        existing.sourceAuth = sourceAuth;
        existing.lastSeen = readIfPresent(targetAuth);
        return;
      }
      this.release(agentId);
    }

    this.watched.set(agentId, {
      agentId,
      targetAuth,
      sourceAuth,
      lastSeen: readIfPresent(targetAuth),
    });

    try {
      fs.watchFile(
        targetAuth,
        { interval: this.pollIntervalMs, persistent: false },
        () => {
          this.syncOnce(agentId);
        }
      );
    } catch {
      // 감시를 못 걸어도 사본 자체는 이미 깔렸다 — 스폰을 막지 않는다.
    }
  }
}

/** 메인 프로세스 공용 브로커. */
export const grokAuthBroker = new GrokAuthBroker();
