/**
 * 공개 Replay 저장·서빙 계층 (Phase 4-1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §4 Phase 4 · §7(공개 URL 호스팅)
 * · §5.7 F6(추측불가 id · fail-closed 룰 · 캐시 잔존).
 *
 * ─────────────────────────────────────────────────────────────────
 * ★문서를 두 개로 쪼갠 이유 (이게 이 파일의 핵심 설계다)
 * ─────────────────────────────────────────────────────────────────
 * 공개 문서에는 **비식별판 payload 말고는 아무것도** 들어가지 않는다. 그런데
 * 룰이 "누가 발행/해제할 수 있는가"를 판정하려면 `projectId` 가 필요하고,
 * 그걸 공개 문서에 넣는 순간 내부 식별자(Firestore 20자 프로젝트 id, 발행자
 * uid)가 **전 세계에 공개된다** — R16(티켓/문서 id ANON)·R2b(사람 식별자
 * ANON)를 정면으로 어긴다. 비식별화 엔진이 payload 안의 id 를 다 지워 놓고
 * 문서 봉투에 원본 id 를 적어 보내면 아무 의미가 없다.
 *
 * 그래서:
 *   - `publicReplays/{replayId}`      = **공개**. 비식별판 payload + 등급 + 발행시각.
 *                                       내부 id 0개. anon read 는 여기까지만.
 *   - `publicReplayOwners/{replayId}` = **비공개 소유권 인덱스**. projectId ·
 *                                       missionId · publisherUid · 상태.
 *                                       프로젝트 멤버만 read, owner/admin 만 write.
 *
 * 룰은 공개 문서 write 를 판정할 때 소유권 문서를 `get()` 해서 owner/admin 을
 * 확인한다(§7.1 "write = 소유자만", Q4 owner/admin only). 공개 표면에는
 * 아무 흔적도 남지 않는다.
 *
 * ─────────────────────────────────────────────────────────────────
 * ★replayId 는 왜 crypto 난수인가 (§5.7 F6)
 * ─────────────────────────────────────────────────────────────────
 * 해제해도 CDN·소셜 캐시·검색 인덱스에는 사본이 남는다. 그러니 최소한
 * **"id 를 열거해서 취소본을 찾는" 경로는 닫아야** 한다. 두 가지를 같이 건다:
 *   1) id 자체가 130비트 난수라 추측·열거가 불가능하다.
 *   2) 룰이 `list` 를 전면 차단한다(`allow list: if false`) — get 만 가능.
 * `missionId` 를 그대로 쓰거나 순번을 쓰면 두 방어가 동시에 무너진다.
 *
 * 난수원이 없으면 **던진다.** `Math.random()` 폴백은 절대 만들지 않는다 —
 * 폴백이 있으면 예측 가능한 id 가 조용히 발행되고, 그게 정확히 F6 이 막으려는
 * 실패다("가릴 수 없으면 드롭한다"의 id 판).
 *
 * ─────────────────────────────────────────────────────────────────
 * ★업로드되는 바이트 = 2차 검증을 통과한 바로 그 문자열
 * ─────────────────────────────────────────────────────────────────
 * payload 는 map 이 아니라 `RedactedReplay.serialized` **문자열 그대로** 저장한다.
 * map 으로 넣으면 Firestore 가 재직렬화하므로 "검증한 바이트"와 "저장된 바이트"
 * 사이에 틈이 생긴다. 검증(§5.2 P4)은 직렬화된 문자열에 대해 돌았으니, 그
 * 문자열이 그대로 올라가야 검증이 의미를 가진다. 웹은 이 문자열을 파싱해서
 * 렌더하되 **모든 필드를 신뢰 불가로 이스케이프**한다(§5.7 F5 — P4-2 범위).
 *
 * ─────────────────────────────────────────────────────────────────
 * ★정직한 한계 (설계 §7.3 대비)
 * ─────────────────────────────────────────────────────────────────
 * 설계 §7.3 은 발행을 Cloud Functions 경유로 두고 서버에서 스키마·크기·레이트를
 * 강제하라고 한다. 이 슬라이스는 **클라이언트 write + 룰 강제**다(티켓 제약:
 * functions 배포 금지). 룰이 대신 잡는 것: 필드 allowlist, 등급 enum, 크기 상한,
 * 상태값, 소유권. 룰이 **못** 잡는 것: 사용자당 발행 수 상한, 레이트리밋,
 * 비식별화 실제 수행 여부. 앞의 둘은 후속 functions 티켓, 세 번째는 구조적으로
 * 클라이언트에 남는다(비식별화는 항상 기기에서 끝난다는 설계 불변식의 뒷면).
 *
 * ★F7: 실패 로그·에러 메시지에 payload 원문을 절대 싣지 않는다. 이 파일의
 * 에러는 규칙·위치·크기만 말한다.
 */

import { orderBy, where, limit as limitTo } from "firebase/firestore";
import type { QueryConstraint } from "firebase/firestore";
import {
  getStorage,
  ref as storageObjectRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import type {
  MissionReplay,
  RedactedReplay,
  ReplayVisibilityLevel,
} from "../types/missionReplay";
import { isReplayPublicationCandidate } from "../lib/replay/redactReplay";
import { renderReplayCardPng } from "../lib/replay/export/card";
import { app } from "../lib/firebase";
import {
  deleteDocument,
  getDocument,
  queryDocuments,
  setDocument,
  updateDocument,
} from "./firestore";

// ── 컬렉션·상수 ────────────────────────────────────────────────

/** 공개 문서. anon read 대상 — 비식별판 payload 외에는 아무것도 없다. */
export const PUBLIC_REPLAYS_COLLECTION = "publicReplays";
/** 비공개 소유권 인덱스. 룰의 write 판정 근거이자 앱의 발행 목록. */
export const PUBLIC_REPLAY_OWNERS_COLLECTION = "publicReplayOwners";

/** 문서 스키마 버전. 웹 렌더러가 모르는 버전을 만나면 렌더를 거부한다. */
export const PUBLIC_REPLAY_SCHEMA_VERSION = 1;

/**
 * payload 문자열 상한(문자 수). Firestore 문서 한도는 1MiB 이고, 나머지 필드와
 * UTF-8 다바이트 문자를 감안해 절반 아래로 잡는다. **룰에도 같은 수를 박는다**
 * — 여기만 있으면 패치된 클라이언트가 한도까지 밀어 넣을 수 있다.
 */
export const PUBLIC_REPLAY_MAX_PAYLOAD_CHARS = 512_000;

/** 공개 페이지 오리진. 웹 라우트는 `[locale]/replay/[replayId]`(설계 §7.2). */
export const PUBLIC_REPLAY_WEB_ORIGIN = "https://marblo.app";

/** 발행 목록 1회 조회 상한. */
export const PUBLIC_REPLAY_LIST_CAP = 100;

/**
 * id 문자 수. Crockford base32(문자당 5비트) × 26 = **130비트**.
 * 낮추려면 보안 리뷰를 거친다(높이는 건 자유) — §5.5 임계값과 같은 규약.
 */
const REPLAY_ID_CHARS = 26;
/** i·l·o·u 제외(오독 방지). 32글자 = 바이트 하위 5비트와 1:1 이라 편향이 없다. */
const REPLAY_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/**
 * 선두 문자. Firestore 문서 id 규칙(`.`/`..`/`__*__` 금지)을 만족시키고,
 * 로그·URL 에서 "이건 replay id 다"를 사람이 바로 읽게 한다.
 */
const REPLAY_ID_PREFIX = "r";

// ── 저장 형태 ──────────────────────────────────────────────────

export type PublicReplayLevel = Exclude<ReplayVisibilityLevel, "L0">;

/** `publicReplays/{replayId}` — 세상에 공개되는 전부. */
export interface PublicReplayDocument {
  schemaVersion: number;
  replayVersion: number;
  level: PublicReplayLevel;
  /** 룰 read 게이트. 이 값이 아니면 anon read 가 떨어진다(fail-closed). */
  status: "published";
  /** 2차 검증을 통과한 직렬화 바이트 그대로. */
  payload: string;
  publishedAt: Date;
}

/** `publicReplayOwners/{replayId}` — 비공개. 앱만 읽는다. */
export interface PublicReplayOwnerRecord {
  replayId: string;
  projectId: string;
  missionId: string;
  publisherUid: string;
  level: PublicReplayLevel;
  includeCost: boolean;
  status: "published" | "unpublished";
  publishedAt: Date;
  unpublishedAt: Date | null;
  /**
   * 업로드된 미션 카드 이미지의 Storage 파일명(`{contentHash}.png`). 해제 시
   * 이 값으로 정확한 오브젝트를 지운다 — replayId 폴더를 list 하지 않는다
   * (Storage 룰이 `list` 를 별도로 열어주지 않으므로, 아는 경로만 delete 한다).
   * 카드 업로드가 없었거나 실패했으면 null.
   */
  cardImagePath: string | null;
}

export interface PublicReplayRef {
  replayId: string;
  level: PublicReplayLevel;
  url: string;
  publishedAt: Date;
}

// ── 에러 ───────────────────────────────────────────────────────

export type PublicReplayErrorCode =
  | "not-verified" // 2차 검증 실패 — 발행 중단(§5.2 P4)
  | "empty-payload"
  | "payload-too-large"
  | "not-completed" // 완료 미션만이 기본 후보(Q1)
  | "missing-publisher"
  | "no-secure-random" // 난수원 부재 — 폴백 없이 중단(F6)
  | "not-found";

/** ★F7: 메시지에 payload 원문·시크릿을 절대 담지 않는다. */
export class PublicReplayError extends Error {
  readonly code: PublicReplayErrorCode;
  constructor(code: PublicReplayErrorCode, message: string) {
    super(message);
    this.name = "PublicReplayError";
    this.code = code;
  }
}

// ── 주입 가능한 의존 ────────────────────────────────────────────

/**
 * 이 서비스가 만지는 Firestore 표면 전부. 발행/해제 순서와 롤백을 Firestore
 * 없이 단위테스트로 고정하려고 주입 가능하게 둔다(tests/unit/public-replay-service).
 */
export interface PublicReplayDeps {
  setDoc(collection: string, docId: string, data: object): Promise<void>;
  updateDoc(collection: string, docId: string, data: object): Promise<void>;
  deleteDoc(collection: string, docId: string): Promise<void>;
  getDoc<T>(collection: string, docId: string): Promise<T | null>;
  queryDocs<T>(
    collection: string,
    ...constraints: QueryConstraint[]
  ): Promise<T[]>;
  /** 암호학적 난수 n 바이트. 없으면 던진다 — 폴백 금지. */
  randomBytes(size: number): Uint8Array;
  now(): Date;
  /**
   * 발행 카드 PNG 렌더러. 기본은 `lib/replay/export/card.ts`(브라우저 canvas).
   * 없으면 카드 첨부 단계 자체가 스킵된다(★공개 URL 발행은 카드 없이도 성립).
   * 테스트가 DOM 없이 이 경로를 고정할 수 있도록 주입 가능하게 둔다.
   */
  renderCardImage?(redacted: RedactedReplay): Promise<Blob>;
  /**
   * 카드 PNG 바이트를 `public-replays/{replayId}/{fileName}` 에 올리고 공개
   * 다운로드 URL 을 돌려준다. 없으면(테스트·아직 storage.rules 미배포 환경)
   * 카드 이미지 단계 전체를 건너뛴다 — ★발행 자체는 막지 않는다.
   */
  uploadCardImage?(
    replayId: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<string>;
  /** 해제 시 카드 이미지 삭제. 애초에 없었어도(업로드 실패 등) 조용히 넘어간다. */
  deleteCardImage?(replayId: string, fileName: string): Promise<void>;
  /** PNG 바이트 → 콘텐츠 해시(파일명용). 기본 SHA-256. */
  hashCardImageBytes?(bytes: Uint8Array): Promise<string>;
}

function defaultRandomBytes(size: number): Uint8Array {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || typeof webCrypto.getRandomValues !== "function") {
    throw new PublicReplayError(
      "no-secure-random",
      "암호학적 난수원을 쓸 수 없어 발행을 중단합니다. 예측 가능한 공개 URL 은 만들지 않습니다.",
    );
  }
  return webCrypto.getRandomValues(new Uint8Array(size));
}

// ── 카드 이미지 저장소 (Storage) ─────────────────────────────────
//
// ★storage.rules 배포 전에는 이 경로가 전부 거부된다(티켓 제약). 그래서 카드
// 이미지 단계는 처음부터 "실패해도 발행은 계속된다" best-effort 로 설계한다 —
// 업로드가 막혀도 기본 정적 OG(P4-2 A안)로 조용히 폴백한다.

let cachedStorage: ReturnType<typeof getStorage> | null = null;
function replayStorage(): ReturnType<typeof getStorage> {
  if (!cachedStorage) cachedStorage = getStorage(app);
  return cachedStorage;
}

function cardImageStoragePath(replayId: string, fileName: string): string {
  return `public-replays/${replayId}/${fileName}`;
}

async function defaultRenderCardImage(redacted: RedactedReplay): Promise<Blob> {
  return renderReplayCardPng(redacted);
}

async function defaultUploadCardImage(
  replayId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const objectRef = storageObjectRef(
    replayStorage(),
    cardImageStoragePath(replayId, fileName),
  );
  await uploadBytes(objectRef, bytes, { contentType: "image/png" });
  return getDownloadURL(objectRef);
}

async function defaultDeleteCardImage(
  replayId: string,
  fileName: string,
): Promise<void> {
  await deleteObject(
    storageObjectRef(replayStorage(), cardImageStoragePath(replayId, fileName)),
  );
}

async function defaultHashCardImageBytes(bytes: Uint8Array): Promise<string> {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle) {
    throw new Error(
      "Web Crypto subtle 을 쓸 수 없어 카드 이미지 해시를 만들 수 없습니다.",
    );
  }
  const digest = await webCrypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

const defaultDeps: PublicReplayDeps = {
  setDoc: (collection, docId, data) => setDocument(collection, docId, data),
  updateDoc: (collection, docId, data) =>
    updateDocument(collection, docId, data),
  deleteDoc: (collection, docId) => deleteDocument(collection, docId),
  getDoc: <T>(collection: string, docId: string) =>
    getDocument<T>(collection, docId),
  queryDocs: <T>(collection: string, ...constraints: QueryConstraint[]) =>
    queryDocuments<T>(collection, ...constraints),
  randomBytes: defaultRandomBytes,
  now: () => new Date(),
  renderCardImage: defaultRenderCardImage,
  uploadCardImage: defaultUploadCardImage,
  deleteCardImage: defaultDeleteCardImage,
  hashCardImageBytes: defaultHashCardImageBytes,
};

// ── id ─────────────────────────────────────────────────────────

/**
 * 추측 불가능한 공개 id (§5.7 F6). 130비트 난수 + 사람이 읽는 접두사.
 *
 * 편향 없음: 알파벳이 32글자라 `byte & 31` 이 균등하다(256 % 32 == 0).
 */
export function generateReplayId(
  randomBytes: (size: number) => Uint8Array = defaultRandomBytes,
): string {
  const bytes = randomBytes(REPLAY_ID_CHARS);
  if (bytes.length < REPLAY_ID_CHARS) {
    throw new PublicReplayError(
      "no-secure-random",
      "난수 바이트가 부족해 발행을 중단합니다.",
    );
  }
  let id = REPLAY_ID_PREFIX;
  for (let i = 0; i < REPLAY_ID_CHARS; i += 1) {
    id += REPLAY_ID_ALPHABET[bytes[i] & 31];
  }
  return id;
}

/** 공개 URL. 웹 라우트는 로케일 접두사를 갖는다(설계 §7.2, marblo-web 규약). */
export function publicReplayUrl(replayId: string, locale = "ko"): string {
  return `${PUBLIC_REPLAY_WEB_ORIGIN}/${locale}/replay/${replayId}`;
}

// ── 발행 ───────────────────────────────────────────────────────

export interface PublishReplayInput {
  /** 링크(projectId·missionId) 용도로만 쓴다. **원본은 업로드되지 않는다.** */
  replay: MissionReplay;
  /** 업로드되는 유일한 입력. 타입이 원본 유입을 막는다(§8 R2). */
  redacted: RedactedReplay;
  publisherUid: string;
  /** R14 독립 opt-in 의 기록값(감사용). payload 내용은 이미 확정돼 있다. */
  includeCost?: boolean;
  /** Q1: 기본은 완료 미션만. 실패·중단은 명시 선택 시에만 후보. */
  includeIncomplete?: boolean;
}

/**
 * `redacted.serialized`(검증을 통과한 바로 그 문자열)에 `card.imageUrl` 을
 * 얹는다. 원본 문자열을 다시 파싱해서 고치는 이유 — `redacted.payload` 는
 * `unknown` 이라 `serialized` 와 구조가 1:1 이라는 보장이 없고, 검증은
 * `serialized` 위에서 돌았다(§5.2 P4). 배열/비객체 JSON 이거나 상한을 넘기면
 * `null` — 이 경우 카드 없이 원래 문자열 그대로 발행한다(가리는 게 아니라
 * 조용한 기능 축소).
 */
function embedCardImageUrl(
  serialized: string,
  imageUrl: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const patched = JSON.stringify({
    ...(parsed as Record<string, unknown>),
    card: { imageUrl },
  });
  if (patched.length > PUBLIC_REPLAY_MAX_PAYLOAD_CHARS) return null;
  return patched;
}

/**
 * P3 카드 → PNG 렌더 → 콘텐츠 해시 파일명 → Storage 업로드 → payload 에
 * `card.imageUrl` 첨부까지. **best-effort** — 어느 단계든 실패하면(가장 흔한
 * 경우: storage.rules 미배포로 write 거부) `null` 을 돌려주고 호출부는 카드
 * 없이 발행을 계속한다. 이 기능은 바이럴 훅(OG 미리보기)이지 발행의 필수
 * 조건이 아니다.
 *
 * ★F7 준수: 실패 로그는 사유만 남기고 payload·이미지 바이트를 싣지 않는다.
 */
async function attachReplayCard(
  replayId: string,
  redacted: RedactedReplay,
  deps: PublicReplayDeps,
): Promise<{ payload: string; fileName: string } | null> {
  if (!deps.uploadCardImage) return null;
  try {
    const blob = await (deps.renderCardImage ?? defaultRenderCardImage)(
      redacted,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await (deps.hashCardImageBytes ?? defaultHashCardImageBytes)(
      bytes,
    );
    const fileName = `${hash}.png`;
    const imageUrl = await deps.uploadCardImage(replayId, fileName, bytes);
    const payload = embedCardImageUrl(redacted.serialized, imageUrl);
    return payload ? { payload, fileName } : null;
  } catch (error) {
    console.warn(
      "[publicReplayService] 카드 이미지 첨부 실패 — 기본 OG 로 발행을 계속합니다.",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * 발행. 순서가 계약이다:
 *   1) 소유권 문서 생성 — 룰이 공개 문서 write 를 판정할 근거가 먼저 있어야 한다
 *      (Storage 룰의 `isPublisherOf` 도 이 문서를 읽는다 — 카드 업로드가
 *      가능해지는 것도 이 시점부터다).
 *   1.5) (best-effort) 미션 카드 PNG 렌더 → Storage 업로드 → payload 에
 *      `card.imageUrl` 첨부. 실패해도 발행은 막지 않는다.
 *   2) 공개 문서 생성 — 이 시점에 URL 이 살아난다.
 * 2)가 실패하면 소유권 문서를 `unpublished` 로 되돌린다(삭제는 룰이 막는다 —
 * 발행 시도 자체가 감사 기록으로 남아야 하기 때문).
 */
export async function publishReplay(
  input: PublishReplayInput,
  deps: PublicReplayDeps = defaultDeps,
): Promise<PublicReplayRef> {
  const { replay, redacted, publisherUid } = input;

  if (!publisherUid) {
    throw new PublicReplayError(
      "missing-publisher",
      "로그인 사용자만 발행할 수 있습니다.",
    );
  }
  // ★2차 검증 실패는 "가리고 올린다"가 아니라 **중단**이다(§5.2 P4).
  if (!redacted.verified) {
    throw new PublicReplayError(
      "not-verified",
      "독립 2차 검증에 실패해 발행을 중단했습니다. 룰셋에 구멍이 있다는 신호입니다.",
    );
  }
  if (!redacted.serialized) {
    throw new PublicReplayError(
      "empty-payload",
      "발행할 비식별판 바이트가 비어 있습니다.",
    );
  }
  if (redacted.serialized.length > PUBLIC_REPLAY_MAX_PAYLOAD_CHARS) {
    throw new PublicReplayError(
      "payload-too-large",
      `비식별판 크기가 상한(${PUBLIC_REPLAY_MAX_PAYLOAD_CHARS}자)을 넘습니다: ${redacted.serialized.length}자.`,
    );
  }
  if (!isReplayPublicationCandidate(replay, input.includeIncomplete === true)) {
    throw new PublicReplayError(
      "not-completed",
      "완료된 미션만 공개 후보입니다. 실패·중단 미션은 명시 선택이 필요합니다.",
    );
  }

  const replayId = generateReplayId(deps.randomBytes);
  const publishedAt = deps.now();

  const owner: PublicReplayOwnerRecord = {
    replayId,
    projectId: replay.projectId,
    missionId: replay.missionId,
    publisherUid,
    level: redacted.level,
    includeCost: input.includeCost === true,
    status: "published",
    publishedAt,
    unpublishedAt: null,
    cardImagePath: null,
  };
  await deps.setDoc(PUBLIC_REPLAY_OWNERS_COLLECTION, replayId, owner);

  // ★owner 문서가 committed 된 뒤에만 시도한다 — Storage 룰의 isPublisherOf 가
  // 이 문서를 읽어 write 를 판정한다(§storage.rules). best-effort: 실패해도
  // payload 는 원본 serialized 그대로 발행된다.
  let payload = redacted.serialized;
  const card = await attachReplayCard(replayId, redacted, deps);
  if (card) {
    payload = card.payload;
    await deps
      .updateDoc(PUBLIC_REPLAY_OWNERS_COLLECTION, replayId, {
        cardImagePath: card.fileName,
      })
      .catch(() => undefined); // 인덱스만 놓친다 — 발행 자체는 이미 유효하다
  }

  const publicDoc: PublicReplayDocument = {
    schemaVersion: PUBLIC_REPLAY_SCHEMA_VERSION,
    replayVersion: 1,
    level: redacted.level,
    status: "published",
    payload,
    publishedAt,
  };
  try {
    await deps.setDoc(PUBLIC_REPLAYS_COLLECTION, replayId, publicDoc);
  } catch (error) {
    // 공개 문서가 안 생겼는데 소유권만 published 로 남으면 UI 가 "발행됨"으로
    // 거짓말한다. 되돌린다(삭제는 룰이 막으므로 상태 전이로).
    await deps
      .updateDoc(PUBLIC_REPLAY_OWNERS_COLLECTION, replayId, {
        status: "unpublished",
        unpublishedAt: deps.now(),
      })
      .catch(() => undefined);
    throw error;
  }

  return {
    replayId,
    level: redacted.level,
    url: publicReplayUrl(replayId),
    publishedAt,
  };
}

// ── 해제 ───────────────────────────────────────────────────────

/**
 * 해제. 공개 문서를 먼저 지운다 — 그게 실제로 URL 을 죽이는 유일한 동작이고,
 * 소유권 상태 갱신이 실패해도 공개 표면은 이미 닫혀 있어야 하기 때문이다.
 *
 * 카드 이미지가 있었으면 함께 지운다. **아는 경로만** 지운다(소유권 문서의
 * `cardImagePath`) — replayId 폴더를 list 하지 않는다(Storage 룰이 `list` 를
 * 열어주지 않는다, §storage.rules). 삭제 실패는 삼킨다 — 이미지 하나 남는 게
 * 해제 자체를 막을 이유는 아니다(어차피 캐시 잔존은 되돌릴 수 없다, §7.1).
 *
 * ★이 함수는 캐시를 지우지 못한다. CDN·소셜 카드·검색 인덱스·스크린샷에 남은
 * 사본은 되돌릴 수 없다(설계 §7.1, R7/F6). 그 사실은 UI 가 **해제 전에**
 * 사용자에게 말해야 한다 — `ReplayPublishPanel` 이 담당한다.
 */
export async function unpublishReplay(
  replayId: string,
  deps: PublicReplayDeps = defaultDeps,
): Promise<void> {
  await deps.deleteDoc(PUBLIC_REPLAYS_COLLECTION, replayId);

  if (deps.deleteCardImage) {
    const owner = await deps
      .getDoc<PublicReplayOwnerRecord>(
        PUBLIC_REPLAY_OWNERS_COLLECTION,
        replayId,
      )
      .catch(() => null);
    if (owner?.cardImagePath) {
      await deps
        .deleteCardImage(replayId, owner.cardImagePath)
        .catch(() => undefined);
    }
  }

  await deps.updateDoc(PUBLIC_REPLAY_OWNERS_COLLECTION, replayId, {
    status: "unpublished",
    unpublishedAt: deps.now(),
  });
}

// ── 조회 ───────────────────────────────────────────────────────

/** 프로젝트의 발행 이력(해제분 포함). 소유권 인덱스만 읽는다. */
export async function listProjectPublications(
  projectId: string,
  deps: PublicReplayDeps = defaultDeps,
): Promise<PublicReplayOwnerRecord[]> {
  return deps.queryDocs<PublicReplayOwnerRecord>(
    PUBLIC_REPLAY_OWNERS_COLLECTION,
    where("projectId", "==", projectId),
    orderBy("publishedAt", "desc"),
    limitTo(PUBLIC_REPLAY_LIST_CAP),
  );
}

/**
 * 이 미션이 지금 발행돼 있나. 여러 번 발행/해제했을 수 있으므로 최신순으로
 * 읽고 `published` 만 고른다.
 */
export async function getMissionPublication(
  projectId: string,
  missionId: string,
  deps: PublicReplayDeps = defaultDeps,
): Promise<PublicReplayOwnerRecord | null> {
  const rows = await deps.queryDocs<PublicReplayOwnerRecord>(
    PUBLIC_REPLAY_OWNERS_COLLECTION,
    where("projectId", "==", projectId),
    where("missionId", "==", missionId),
    orderBy("publishedAt", "desc"),
    limitTo(PUBLIC_REPLAY_LIST_CAP),
  );
  return rows.find((row) => row.status === "published") ?? null;
}

/**
 * 공개 문서 1건 조회(앱 내 확인용 — 웹은 자기 SDK 로 읽는다).
 * 없거나 발행 상태가 아니면 `null` — 존재 여부를 구분해 알려주지 않는다(F6).
 */
export async function getPublicReplay(
  replayId: string,
  deps: PublicReplayDeps = defaultDeps,
): Promise<PublicReplayDocument | null> {
  const doc = await deps.getDoc<PublicReplayDocument>(
    PUBLIC_REPLAYS_COLLECTION,
    replayId,
  );
  if (!doc || doc.status !== "published") return null;
  return doc;
}
