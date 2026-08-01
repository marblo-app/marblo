/**
 * 공개 Replay 리더 — marblo-web 의 **신뢰 경계 한 곳** (Phase 4-2).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §4 Phase 4 · §7.2(웹) · §5.7 F5.
 *
 * ─────────────────────────────────────────────────────────────────
 * ★F5 — 비식별화 통과 ≠ 안전한 HTML
 * ─────────────────────────────────────────────────────────────────
 * `publicReplays/{replayId}.payload` 는 기기에서 비식별화 + 독립 2차 검증을
 * 통과한 바이트다. 그건 **시크릿·경로·PII 가 없다**는 뜻이지, **마크업이 없다**는
 * 뜻이 아니다. 실측(P2-2 `redactReplay` 를 L1/L2/L3 로 돌려 확인):
 *
 *   goal        : "<img src=x onerror=alert(1)>Ship public replay page</script>"
 *   beats[].title: "<script>alert('xss')</script> Implement page"
 *
 * 둘 다 **그대로 통과한다**. `goal`/`title` 은 `structuredSafe` 로 분류돼 값이
 * 보존되고, 비식별화 엔진의 스캐너는 시크릿 패턴을 찾지 마크업을 찾지 않기
 * 때문이다. 마블로 사용자가 자기 미션 제목에 무엇을 적든 그건 결국 marblo.app
 * 도메인에서 렌더되는 남의 문자열이다 — 저장형 XSS 의 교과서적 조건이다.
 *
 * 그래서 이 파일이 **유일한 입구**다:
 *   1) 문서 봉투를 검증한다(status/schemaVersion/level/크기). 하나라도 어긋나면
 *      **null** — 렌더하지 않는다(fail-closed).
 *   2) payload 를 파싱해 **알려진 필드만** 뽑는다. 모르는 키는 버린다
 *      (§5.2 P1 default-deny 를 렌더 쪽에서 한 번 더 건다 — 나중에 발행 스키마에
 *      필드가 늘어도 웹이 그것을 자동으로 그리지 않는다).
 *   3) 남은 값은 전부 새니타이즈된 **문자열/숫자**다. 페이지는 이 뷰모델만 받고,
 *      React 텍스트 노드로만 그린다. `dangerouslySetInnerHTML` 은 이 라우트에
 *      한 글자도 없다 — ★replay 데이터로 만드는 JSON-LD 도 없다. 레포 관행상
 *      JSON-LD 는 `dangerouslySetInnerHTML` 로 주입되는데, `goal` 안에 `</script>`
 *      하나만 있어도 그게 정확히 F5 구멍이 된다.
 *
 * ★"React 가 알아서 이스케이프한다"에 기대지 않는 부분이 있다. React 가 막아주지
 * **않는** 것: `href`/`src` 의 스킴(`javascript:`, `data:`), 그리고 텍스트로는
 * 무해하지만 UI 를 속이는 제어·양방향 문자(U+202E 류 Trojan-Source 스푸핑).
 * 그 둘은 여기서 손으로 막는다.
 */

/** 룰의 read 게이트와 같은 값. 이 상태가 아니면 애초에 read 가 떨어진다. */
const PUBLISHED = "published";

/** 발행 서비스(v3 `publicReplayService.ts`)와 같은 수. 둘이 갈리면 렌더를 거부한다. */
export const PUBLIC_REPLAY_SCHEMA_VERSION = 1;
export const PUBLIC_REPLAY_REPLAY_VERSION = 1;
export const PUBLIC_REPLAY_MAX_PAYLOAD_CHARS = 512_000;

/** `publicReplays` — 웹이 읽는 유일한 컬렉션(설계 §7.2). */
export const PUBLIC_REPLAY_COLLECTION = "publicReplays";

/**
 * replayId 형태 = `r` + Crockford base32(i·l·o·u 제외) 26자 = 130비트.
 * v3 `publicReplayService.generateReplayId` 와 같은 알파벳.
 *
 * 형태가 아니면 **네트워크에 나가기도 전에** 404 로 끝낸다. 문서 경로에 임의
 * 문자열이 실리는 것을 막고(경로 조작), 열거 시도의 비용을 우리 쪽에서 0 으로
 * 만든다(룰의 `allow list: if false` 와 같은 방향의 방어).
 */
export const REPLAY_ID_PATTERN = /^r[0123456789abcdefghjkmnpqrstvwxyz]{26}$/;

export type PublicReplayLevel = "L1" | "L2" | "L3";

const LEVELS: readonly string[] = ["L1", "L2", "L3"];

// ── 새니타이저 ─────────────────────────────────────────────────

/**
 * C0/C1 제어문자. 텍스트로 렌더돼도 터미널 로그·복사 붙여넣기·스크린리더에서
 * 이상하게 동작한다.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/**
 * ★양방향 제어문자 + 보이지 않는 문자. "Trojan Source" 계열 스푸핑의 재료다 —
 * 텍스트 이스케이프만으로는 안 막힌다. 화면에 보이는 순서와 실제 문자열 순서를
 * 갈라놓아 "안전해 보이는 제목"을 만들 수 있으므로 통째로 제거한다.
 */
const BIDI_AND_INVISIBLE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function stripUnsafeChars(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(BIDI_AND_INVISIBLE, "");
}

/**
 * 한 줄 텍스트. 문자열이 아니면 빈 문자열 — 호출부는 "없음"으로 다룬다.
 * 길이 상한은 XSS 가 아니라 레이아웃/DoS 방어다(payload 상한이 512KB 라
 * 한 필드가 그 전부를 차지할 수 있다).
 */
export function safeText(value: unknown, max = 300): string {
  if (typeof value !== "string") return "";
  const cleaned = stripUnsafeChars(value).replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}…`;
}

/** 여러 줄 텍스트(L3 발췌). 줄바꿈만 살리고 나머지는 같은 규칙. */
export function safeParagraph(value: unknown, max = 2000): string {
  if (typeof value !== "string") return "";
  const cleaned = stripUnsafeChars(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}…`;
}

/** 유한 숫자만. `NaN`/`Infinity`/문자열 숫자는 전부 거부한다. */
export function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * PR 링크. ★React 는 `href` 의 스킴을 검사하지 않는다 — `javascript:alert(1)`
 * 을 그대로 렌더한다. 그래서 여기가 유일한 관문이다:
 *   - `https:` 만 (http·javascript·data·blob 전부 거부)
 *   - 자격증명 박힌 URL(`https://user:pw@…`) 거부
 *   - 호스트 화이트리스트 — 설계 R11 은 "공개 저장소만" 인데, 공개 판정은 발행
 *     시점에 앱이 한다. 웹은 그 판정을 믿되 **호스트만은 다시 좁힌다**(2중 게이트).
 */
const PR_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
  "bitbucket.org",
]);

export function safePrUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 400) return null;
  let url: URL;
  try {
    url = new URL(stripUnsafeChars(value).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!PR_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url.toString();
}

/**
 * 공유카드 이미지 URL(OG). 지금은 발행 문서에 이 칸이 없다(룰의 필드
 * allowlist 가 [schemaVersion, replayVersion, level, status, payload,
 * publishedAt] 로 못박혀 있고, P3 카드는 다운로드 전용이라 업로드 경로가 없다).
 * 그래서 payload 안 optional `card.imageUrl` 을 **미리** 지원해 둔다 — 후속
 * 티켓이 업로드를 붙이면 웹 수정 없이 미션별 카드로 전환된다. 그때 임의 호스트가
 * marblo.app 의 OG 로 실리면 안 되므로 Firebase Storage 호스트로 좁힌다.
 */
const CARD_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
]);

export function safeCardImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 600) return null;
  let url: URL;
  try {
    url = new URL(stripUnsafeChars(value).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!CARD_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url.toString();
}

/**
 * 크레딧 핸들(Q5 — opt-in, 기본 익명). 사용자가 자유롭게 적는 칸이라 **가장
 * 공격자 친화적인 필드**다. 마크업을 이스케이프하는 데 그치지 않고 핸들이
 * 가질 수 있는 문자 자체를 좁힌다(허용 밖이면 크레딧을 아예 표시하지 않는다).
 * 링크로 만들지 않는다 — 핸들에서 URL 을 조립하는 순간 오픈 리다이렉트다.
 */
export function safeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = stripUnsafeChars(value).trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,38}$/.test(raw)) return null;
  return `@${raw}`;
}

// ── 뷰 모델 ────────────────────────────────────────────────────

export interface PublicReplayStats {
  tasks: number | null;
  tasksDone: number | null;
  agents: number | null;
  prs: number | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesDeleted: number | null;
  testsPassed: number | null;
  riskFlags: number | null;
  /** `testsPassed`/`riskFlags` 의 분모. 없으면 비율 표기를 하지 않는다. */
  reportsScanned: number | null;
  retries: number | null;
  /** R14 독립 opt-in. 대개 null(기본 OFF). */
  costTotal: number | null;
}

export interface PublicReplayCastMember {
  agentRef: string;
  vendor: string;
  spawnedModel: string;
  detectedModelId: string;
  role: string;
  tasksCompleted: number | null;
  beats: number | null;
}

export interface PublicReplayBeat {
  id: string;
  /** L1/L2 는 상대 시각 문자열(`+02:13`), L3 는 ISO. 그대로 텍스트로 쓴다. */
  ts: string;
  kind: string;
  title: string;
  taskId: string;
  agentRef: string;
  actorRef: string;
  /** L3 에서만 존재. R1~R8 을 통과한 발췌. */
  detail: string;
  lane: string;
  sensitivity: string;
}

export interface PublicReplayView {
  level: PublicReplayLevel;
  /** ISO 문자열. 파싱 실패 시 빈 문자열. */
  publishedAt: string;
  goal: string;
  templateId: string;
  launchedAt: string;
  completedAt: string;
  durationMs: number | null;
  stats: PublicReplayStats;
  cast: PublicReplayCastMember[];
  beats: PublicReplayBeat[];
  /** 렌더 상한을 넘겨 잘린 비트 수. 0 이면 전부 보여준 것이다. */
  beatsOmitted: number;
  prUrls: string[];
  /** opt-in 크레딧. 익명이거나 핸들이 규칙 밖이면 null → 표시하지 않는다. */
  creditHandle: string | null;
  /**
   * 공유카드 이미지(OG). 지금은 대개 null — `safeCardImageUrl` 주석 참고.
   * 후속 티켓이 payload 에 `card.imageUrl` 을 실으면 자동으로 살아난다.
   */
  cardImageUrl: string | null;
}

/** 렌더 상한. payload 상한이 512KB 라 비트 수는 얼마든 커질 수 있다. */
const MAX_BEATS = 300;
const MAX_CAST = 60;
const MAX_PR_URLS = 20;

// ── payload 파싱 ───────────────────────────────────────────────

/**
 * 프로토타입 오염 방어. `JSON.parse` 자체는 `__proto__` 를 own property 로
 * 정의하므로 즉시 위험하진 않지만, 그 객체가 어딘가에서 spread/merge 되면
 * 이야기가 달라진다. 파싱 단계에서 통째로 버리는 게 싸다.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw, (key, value) =>
      FORBIDDEN_KEYS.has(key) ? undefined : value
    );
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseStats(value: unknown): PublicReplayStats {
  const src = asRecord(value) ?? {};
  // ★키 화이트리스트. 발행 스키마에 필드가 늘어도 웹은 그것을 자동으로 그리지
  //   않는다 — 공개 표면의 확장은 항상 의식적인 커밋이어야 한다.
  return {
    tasks: safeNumber(src.tasks),
    tasksDone: safeNumber(src.tasksDone),
    agents: safeNumber(src.agents),
    prs: safeNumber(src.prs),
    filesChanged: safeNumber(src.filesChanged),
    linesAdded: safeNumber(src.linesAdded),
    linesDeleted: safeNumber(src.linesDeleted),
    testsPassed: safeNumber(src.testsPassed),
    riskFlags: safeNumber(src.riskFlags),
    reportsScanned: safeNumber(src.reportsScanned),
    retries: safeNumber(src.retries),
    costTotal: safeNumber(src.costTotal),
  };
}

function parseCast(value: unknown): PublicReplayCastMember[] {
  return asArray(value)
    .slice(0, MAX_CAST)
    .map((entry) => {
      const src = asRecord(entry) ?? {};
      return {
        agentRef: safeText(src.agentRef, 60),
        vendor: safeText(src.vendor, 40),
        spawnedModel: safeText(src.spawnedModel, 60),
        detectedModelId: safeText(src.detectedModelId, 60),
        role: safeText(src.role, 40),
        tasksCompleted: safeNumber(src.tasksCompleted),
        beats: safeNumber(src.beats),
      };
    })
    .filter((member) => member.agentRef !== "" || member.vendor !== "");
}

function parseBeats(value: unknown): {
  beats: PublicReplayBeat[];
  omitted: number;
} {
  const all = asArray(value);
  const beats = all.slice(0, MAX_BEATS).map((entry) => {
    const src = asRecord(entry) ?? {};
    return {
      id: safeText(src.id, 40),
      ts: safeText(src.ts, 40),
      kind: safeText(src.kind, 60),
      title: safeText(src.title, 300),
      taskId: safeText(src.taskId, 40),
      agentRef: safeText(src.agentRef, 60),
      actorRef: safeText(src.actorRef, 60),
      detail: safeParagraph(src.detail, 1200),
      lane: safeText(src.lane, 20),
      sensitivity: safeText(src.sensitivity, 20),
    };
  });
  return { beats, omitted: Math.max(0, all.length - beats.length) };
}

function parsePrUrls(value: unknown): string[] {
  // 발행 페이로드의 `prUrl` 은 배열이지만, 단일 문자열로 오는 경우도 견딘다.
  const candidates = Array.isArray(value) ? value : [value];
  const urls: string[] = [];
  for (const candidate of candidates) {
    const url = safePrUrl(candidate);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= MAX_PR_URLS) break;
  }
  return urls;
}

/** Q5: `mode === "credited"` 이고 핸들이 규칙을 만족할 때만 크레딧이 산다. */
function parseCredit(value: unknown): string | null {
  const credits = asRecord(value);
  if (!credits) return null;
  if (credits.mode !== "credited") return null;
  return safeHandle(credits.handle);
}

/** 카드 이미지(OG). 지금은 대개 null — 위 `safeCardImageUrl` 주석 참고. */
export function parseCardImageUrl(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const card = asRecord(root.card);
  return safeCardImageUrl(card?.imageUrl);
}

// ── 문서 봉투 검증 ─────────────────────────────────────────────

/** REST/SDK 어느 쪽에서 왔든 이 모양으로 정규화해 넘긴다. */
export interface PublicReplayDocument {
  schemaVersion?: unknown;
  replayVersion?: unknown;
  level?: unknown;
  status?: unknown;
  payload?: unknown;
  publishedAt?: unknown;
}

/**
 * 봉투 → 뷰모델. 어긋나면 **null**(= 404). "일부만 그린다"는 선택지는 없다 —
 * 모르는 스키마를 최선 노력으로 렌더하는 순간 이 파일의 화이트리스트가 무의미해진다.
 */
export function parsePublicReplayDocument(
  doc: PublicReplayDocument | null | undefined
): PublicReplayView | null {
  if (!doc) return null;
  if (doc.status !== PUBLISHED) return null;
  if (safeNumber(doc.schemaVersion) !== PUBLIC_REPLAY_SCHEMA_VERSION) {
    return null;
  }
  if (safeNumber(doc.replayVersion) !== PUBLIC_REPLAY_REPLAY_VERSION) {
    return null;
  }
  if (typeof doc.level !== "string" || !LEVELS.includes(doc.level)) return null;
  if (typeof doc.payload !== "string") return null;
  if (
    doc.payload.length === 0 ||
    doc.payload.length > PUBLIC_REPLAY_MAX_PAYLOAD_CHARS
  ) {
    return null;
  }

  const payload = asRecord(parseJsonSafely(doc.payload));
  if (!payload) return null;

  const { beats, omitted } = parseBeats(payload.beats);

  return {
    level: doc.level as PublicReplayLevel,
    publishedAt: safeText(doc.publishedAt, 40),
    goal: safeText(payload.goal, 300),
    templateId: safeText(payload.templateId, 80),
    launchedAt: safeText(payload.launchedAt, 40),
    completedAt: safeText(payload.completedAt, 40),
    durationMs: safeNumber(payload.durationMs),
    stats: parseStats(payload.stats),
    cast: parseCast(payload.cast),
    beats,
    beatsOmitted: omitted,
    prUrls: parsePrUrls(payload.prUrl),
    creditHandle: parseCredit(payload.credits),
    cardImageUrl: parseCardImageUrl(payload),
  };
}

// ── Firestore REST ─────────────────────────────────────────────

/**
 * 왜 admin SDK 가 아니라 REST 인가:
 *   - 이 페이지는 **미인증 공개 read** 다. 룰이 `status == 'published'` 문서 1건
 *     get 만 허용하므로 서비스 계정 자격증명이 필요 없다. 크레덴셜을 Vercel 에
 *     심지 않는 편이 유출면이 작다.
 *   - 클라이언트 SDK 를 서버에서 돌리는 것보다 가볍고, 크롤러가 JS 없이 읽는
 *     OG 메타를 서버에서 채울 수 있다.
 * 권한이 늘지 않는다: REST 도 같은 보안 규칙을 지난다.
 */
function firestoreDocumentUrl(replayId: string): string {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "marblo-2253d";
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const base =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}` +
    `/databases/(default)/documents/${PUBLIC_REPLAY_COLLECTION}/${encodeURIComponent(
      replayId
    )}`;
  // 웹 API 키는 공개값이다(브라우저 번들에 이미 들어간다). 없으면 그냥 뺀다 —
  // 익명 read 는 키 없이도 규칙 평가를 받는다.
  return apiKey ? `${base}?key=${encodeURIComponent(apiKey)}` : base;
}

/** Firestore REST 의 타입 봉투(`{stringValue: …}`)를 평범한 값으로 되돌린다. */
function decodeRestValue(value: unknown): unknown {
  const field = asRecord(value);
  if (!field) return undefined;
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return field.doubleValue;
  if ("booleanValue" in field) return field.booleanValue;
  if ("timestampValue" in field) return field.timestampValue;
  if ("nullValue" in field) return null;
  return undefined;
}

export function decodeRestDocument(body: unknown): PublicReplayDocument | null {
  const root = asRecord(body);
  const fields = asRecord(root?.fields);
  if (!fields) return null;
  return {
    schemaVersion: decodeRestValue(fields.schemaVersion),
    replayVersion: decodeRestValue(fields.replayVersion),
    level: decodeRestValue(fields.level),
    status: decodeRestValue(fields.status),
    payload: decodeRestValue(fields.payload),
    publishedAt: decodeRestValue(fields.publishedAt),
  };
}

export interface FetchPublicReplayOptions {
  /** ISR 재검증 주기(초). 해제 후 404 로 넘어가는 지연이기도 하다. */
  revalidateSeconds?: number;
  /** 테스트 주입용. */
  fetchImpl?: typeof fetch;
}

/**
 * 발행된 공개 Replay 1건. 없음·비발행·형식 위반은 전부 **null** 이고, 호출부는
 * 그걸 404 로 바꾼다. "존재하지만 비공개"와 "없음"을 구분해 주지 않는 것이
 * F6 의 요구다(취소본 존재 여부조차 알려주지 않는다).
 */
export async function fetchPublicReplay(
  replayId: string,
  options: FetchPublicReplayOptions = {}
): Promise<PublicReplayView | null> {
  if (!REPLAY_ID_PATTERN.test(replayId)) return null;

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(firestoreDocumentUrl(replayId), {
      headers: { Accept: "application/json" },
      next: { revalidate: options.revalidateSeconds ?? 60 },
    } as RequestInit);
  } catch {
    // 네트워크 실패를 "없음"으로 접지 않는다 — 호출부에서 구분하려면 예외가
    // 필요하지만, 이 페이지에서 할 수 있는 정직한 응답은 404 뿐이다.
    return null;
  }

  // 403 = 룰 거부(비발행/해제됨), 404 = 문서 없음. 둘 다 같은 답을 준다.
  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  return parsePublicReplayDocument(decodeRestDocument(body));
}
