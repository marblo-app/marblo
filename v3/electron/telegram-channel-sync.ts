/**
 * telegram-channel-sync — 텔레그램 채널 메타의 기기 간 동기화
 * (티켓 SwAhQrt76lmFjQ1yD5NS: 기기 변경 시 채널 설정 통째 유실 근본수정).
 *
 * ★왜 "메타만" 동기화하는가 (설계 결정):
 *   - 채널 설정은 ~/.marblo/telegram-channels.json 즉 머신 로컬에만 있어서
 *     기기를 바꾸면 통째로 사라졌다(2026-07-18 실사고 — 폰 메시지 하루 두절).
 *   - 그렇다고 봇 토큰을 클라우드에 올릴 수는 없다: BYOK 가 쓰는 safeStorage
 *     암호문은 OS 키체인(머신)에 바인딩되어 **다른 기기에서 복호화 자체가
 *     불가**하므로 올려봐야 이식성에 기여가 없고, 이식 가능한 암호화는
 *     패스프레이즈 E2E 키관리를 자체 구현해야 한다(과설계).
 *   - 그래서 토큰은 기기에 남기고(기존 불변식: 토큰은 ~/.marblo 밖으로 나가지
 *     않는다), 채널 메타(chatId·enabled·inboundCapability·hasBotToken)만
 *     Firestore projects/{projectId} 문서의 `telegramChannel` 필드로 동기화한다.
 *     새 기기는 메타를 복원하고 "봇 토큰만 다시 입력하세요"로 유도한다 —
 *     전체 유실보다 훨씬 낫고 보안 스토리도 단순하다.
 *
 * ★왜 projects 문서의 필드인가:
 *   - 신규 컬렉션이면 firestore.rules 추가 + 배포가 필요하다. projects 문서는
 *     update: isProjectMember 규칙이 이미 있고, electron main 은 renderer 가
 *     전달한 custom token(실사용자 uid — agentAuthService 가 uid 일치를 검증)
 *     으로 인증하므로 규칙 변경·배포 없이 통과한다.
 *   - 익명 인증 폴백 상태(로그인 전/배포 전)에서는 멤버 검사에 걸려 실패한다
 *     — 모든 경로가 fail-soft: 동기화만 조용히 스킵하고 로컬 채널/폴러는
 *     아무 영향도 받지 않는다.
 *
 * ★보안 경계 (pull):
 *   - 원격 메타는 로컬 레코드가 없는 프로젝트만 materialize 하고, 그마저
 *     enabled=false + botToken=null 강제(applyRemoteMeta 참고). access.json
 *     은 절대 건드리지 않는다. 즉 프로젝트 문서를 쓸 수 있는 누구도 이 기기의
 *     폴러/권한을 원격으로 조작할 수 없다 — 활성화는 반드시 이 기기 사용자의
 *     토큰 재입력+저장(가드된 로컬 설정 경로)을 거친다.
 *
 * 부가 기능: pull 시 프로젝트 이름을 캐시해 폴러의 발신 접두([프로젝트명])
 * 라벨로 제공한다(chatId 공유 시 어느 오케의 응답인지 구분용).
 */

import { getAuth } from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";
import {
  applyRemoteTelegramChannelMeta,
  buildRemoteTelegramChannelMeta,
  listTelegramChannelConfigs,
  type InboundCapability,
  type RemoteTelegramChannelMeta,
} from "./telegram-channels";
import {
  parseTelegramLease,
  type TelegramLeaseRemote,
  type TelegramPollerLease,
} from "./telegram-poller-lease";

// ─── 원격 게이트웨이 (테스트 주입용 최소 인터페이스) ─────────────────────

/** pull 이 읽는 프로젝트 문서의 최소 투영. */
export interface RemoteProjectDoc {
  projectId: string;
  name: string | null;
  telegramChannel: RemoteTelegramChannelMeta | null;
}

/**
 * Firestore 접근을 이 두 메서드로 좁힌 게이트웨이 — 동기화 로직(pull/push)을
 * firebase 없이 단위 테스트할 수 있게 한다. 기본 구현은 mission firebase app
 * (custom-token 인증) 을 쓴다.
 */
export interface TelegramMetaRemote {
  /** 내가 멤버인 프로젝트 문서들. 인증이 익명/미완이면 빈 배열. */
  listMyProjects(): Promise<RemoteProjectDoc[]>;
  /** telegramChannel 필드 기록. meta=null 이면 필드 삭제(채널 제거 전파). */
  writeChannelMeta(
    projectId: string,
    meta: RemoteTelegramChannelMeta | null,
  ): Promise<void>;
}

/** Firestore 문서의 telegramChannel 필드를 신뢰-경계 검증해 정규화한다. */
function parseRemoteMeta(raw: unknown): RemoteTelegramChannelMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const chatId = typeof m.chatId === "string" && m.chatId.trim() ? m.chatId : null;
  const capability: InboundCapability =
    m.inboundCapability === "read" ? "read" : "trigger";
  return {
    chatId,
    enabled: m.enabled === true,
    inboundCapability: capability,
    hasBotToken: m.hasBotToken === true,
    updatedAt: typeof m.updatedAt === "number" ? m.updatedAt : 0,
    ...(typeof m.updatedByMachineId === "string"
      ? { updatedByMachineId: m.updatedByMachineId }
      : {}),
  };
}

/** 기본 게이트웨이 — mission firebase app 경유. 실패는 호출자가 처리(fail-soft). */
function createFirestoreRemote(): TelegramMetaRemote {
  return {
    async listMyProjects(): Promise<RemoteProjectDoc[]> {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const user = getAuth(app).currentUser;
      // 익명 폴백 상태에서는 projects 의 멤버 스코프 쿼리가 아무것도 못 읽는다
      // (실사용자 uid 가 아님) — 시도 자체를 스킵해 permission-denied 소음 방지.
      if (!user || user.isAnonymous) return [];
      const db = getFirestore(app);
      const snap = await getDocs(
        query(
          collection(db, "projects"),
          where("members", "array-contains", user.uid),
        ),
      );
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          projectId: d.id,
          name: typeof data.name === "string" ? data.name : null,
          telegramChannel: parseRemoteMeta(data.telegramChannel),
        };
      });
    },
    async writeChannelMeta(
      projectId: string,
      meta: RemoteTelegramChannelMeta | null,
    ): Promise<void> {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const user = getAuth(app).currentUser;
      if (!user || user.isAnonymous) return; // 실사용자 인증 전 — 스킵
      const db = getFirestore(app);
      await setDoc(
        doc(db, "projects", projectId),
        { telegramChannel: meta ?? deleteField() },
        { merge: true },
      );
    },
  };
}

// ─── 프로젝트 라벨 캐시 (발신 접두용) ────────────────────────────────────

/** pull 이 채우는 projectId → 프로젝트 이름 캐시. 프로세스 수명. */
const projectLabelCache = new Map<string, string>();

/**
 * 발신 접두([프로젝트명])용 라벨. pull 이 아직 못 돌았거나 이름이 없으면 null
 * — 호출자(폴러)는 projectId 앞 8자로 폴백한다.
 */
export function getTelegramProjectLabel(projectId: string): string | null {
  return projectLabelCache.get(projectId) ?? null;
}

/** 테스트 훅 — 라벨 캐시 초기화/시딩. */
export function _setTelegramProjectLabels(
  entries: Record<string, string> | null,
): void {
  projectLabelCache.clear();
  if (entries) {
    for (const [k, v] of Object.entries(entries)) projectLabelCache.set(k, v);
  }
}

// ─── pull / push ────────────────────────────────────────────────────────

export interface TelegramMetaSyncResult {
  /** pull 로 이 기기에 새로 materialize 된 프로젝트 수. */
  restored: number;
  /** push 로 원격에 기록(생성/갱신/삭제)한 프로젝트 수. */
  pushed: number;
}

/**
 * pull: 원격 프로젝트 문서들의 telegramChannel 메타를 읽어, 로컬 레코드가
 * 없는 프로젝트를 복원(enabled=false·토큰 없음)하고 이름 캐시를 채운다.
 */
export async function pullTelegramChannelMeta(
  remote: TelegramMetaRemote,
): Promise<number> {
  const projects = await remote.listMyProjects();
  let restored = 0;
  for (const p of projects) {
    if (p.name) projectLabelCache.set(p.projectId, p.name);
    if (!p.telegramChannel) continue;
    if (applyRemoteTelegramChannelMeta(p.projectId, p.telegramChannel)) {
      restored += 1;
    }
  }
  return restored;
}

/**
 * push(리컨사일): 로컬 채널 설정을 원격 메타와 맞춘다.
 *   - 로컬에 실제 설정(토큰 보유 또는 사용자가 만든 레코드)이 있고 원격이
 *     없거나 더 오래됐으면 기록한다 — 이 기능 배포 전부터 쓰던 기존 채널이
 *     첫 기동에서 자동 업로드되는 경로.
 *   - 복원 표식만 있고 토큰이 없는 레코드는 push 하지 않는다(권위자는 토큰을
 *     쥔 기기다 — hasBotToken:true 인 원격 메타를 false 로 덮지 않기 위함).
 */
export async function pushTelegramChannelMetaAll(
  remote: TelegramMetaRemote,
  machineId?: string,
): Promise<number> {
  const projects = await remote.listMyProjects();
  const remoteByProject = new Map(
    projects.map((p) => [p.projectId, p.telegramChannel] as const),
  );
  const myProjectIds = new Set(projects.map((p) => p.projectId));
  let pushed = 0;
  for (const cfg of listTelegramChannelConfigs()) {
    // 내가 멤버가 아닌(또는 삭제된) 프로젝트 문서에는 쓰지 않는다.
    if (!myProjectIds.has(cfg.projectId)) continue;
    if (cfg.restoredFromSync && !cfg.botToken) continue;
    const meta = buildRemoteTelegramChannelMeta(cfg.projectId, machineId);
    if (!meta) continue;
    const existing = remoteByProject.get(cfg.projectId);
    if (existing && existing.updatedAt >= meta.updatedAt) continue;
    await remote.writeChannelMeta(cfg.projectId, meta);
    pushed += 1;
  }
  return pushed;
}

/**
 * 단일 프로젝트 push — 설정 저장/삭제 IPC 직후 호출된다. 로컬 레코드가
 * 없으면(=사용자가 채널을 제거) 원격 필드도 삭제해 다른 기기에서 좀비
 * 복원이 일어나지 않게 한다. fail-soft: 실패는 로그만 남긴다.
 */
export async function pushTelegramChannelMetaOne(
  projectId: string,
  machineId?: string,
  remote: TelegramMetaRemote = createFirestoreRemote(),
): Promise<void> {
  try {
    const meta = buildRemoteTelegramChannelMeta(projectId, machineId);
    // 복원 대기(토큰 없음) 레코드는 push 금지 — pushTelegramChannelMetaAll 과
    // 같은 이유(원격 hasBotToken:true 를 덮지 않는다).
    if (meta && !meta.hasBotToken) {
      const cfg = listTelegramChannelConfigs().find(
        (c) => c.projectId === projectId,
      );
      if (cfg?.restoredFromSync) return;
    }
    await remote.writeChannelMeta(projectId, meta);
  } catch (err) {
    console.warn(
      `[TelegramChannelSync] push failed for project=${projectId} (fail-soft): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * 전체 동기화(pull → push 리컨사일) — 앱 기동 시(authReady 후)와 custom-token
 * 인증이 성립한 순간 호출된다. 어떤 실패도 밖으로 던지지 않는다(fail-soft):
 * 동기화는 부가 기능이고, 로컬 채널/폴러는 이것 없이도 그대로 동작해야 한다.
 */
export async function syncTelegramChannelMeta(
  machineId?: string,
  remote: TelegramMetaRemote = createFirestoreRemote(),
): Promise<TelegramMetaSyncResult> {
  const result: TelegramMetaSyncResult = { restored: 0, pushed: 0 };
  try {
    result.restored = await pullTelegramChannelMeta(remote);
  } catch (err) {
    console.warn(
      `[TelegramChannelSync] pull failed (fail-soft): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  try {
    result.pushed = await pushTelegramChannelMetaAll(remote, machineId);
  } catch (err) {
    console.warn(
      `[TelegramChannelSync] push reconcile failed (fail-soft): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (result.restored > 0) {
    console.log(
      `[TelegramChannelSync] restored ${result.restored} telegram channel ` +
        `meta record(s) from cloud — bot token re-entry required per project ` +
        `(tokens never sync across machines).`,
    );
  }
  return result;
}

// ─── 폴러 리스 게이트웨이 (티켓 hAzP05kOTxggd8LhZGwT) ────────────────────
//
// ★왜 같은 문서의 필드인가: 채널 메타와 똑같은 이유다 — projects 문서는
// update: isProjectMember 규칙이 이미 있어 firestore.rules 변경·배포가 필요
// 없다. 새 컬렉션이면 규칙 배포가 선행되어야 하고, 그때까지 리스는 전부
// permission-denied → 항상 fail-open → 기능이 사실상 없는 것과 같아진다.
//
// ★필드에 담기는 것: holderId(machineId) · hostLabel(호스트명) ·
// tokenHash(sha256 앞 16자) · renewedAt. ★봇 토큰 원문은 어떤 형태로도 담기지
// 않는다 — 토큰은 기기 로컬(~/.marblo)에만 산다는 기존 불변식 그대로다.
//
// ★여기서는 fail-soft 가 아니라 **던진다**. 채널 메타 동기화는 실패해도 조용히
// 스킵하면 되지만, 리스 읽기가 조용히 null 을 돌려주면 매니저가 "빈 자리"로
// 오인해 가드가 있다고 착각한다. 던져야 매니저가 fail-open 으로 판정하고 그
// 사실이 진단에 남는다.

/** 프로젝트 문서에서 리스가 사는 필드 이름. */
export const TELEGRAM_LEASE_FIELD = "telegramPollerLease";

/** 인증이 아직 실사용자가 아닐 때의 리스 접근 실패 — fail-open 사유가 된다. */
export class TelegramLeaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramLeaseUnavailableError";
  }
}

/**
 * Firestore projects/{projectId}.telegramPollerLease 게이트웨이. 실패는 전부
 * 던지고, 폴러 쪽 리스 매니저가 fail-open 으로 흡수한다.
 */
export function createTelegramLeaseRemote(): TelegramLeaseRemote {
  async function requireUserDb() {
    const { app, authReady } = getMissionFirebaseApp();
    await authReady;
    const user = getAuth(app).currentUser;
    if (!user || user.isAnonymous) {
      // 익명 폴백 상태에서는 projects 문서에 접근할 수 없다. 조용히 통과시키면
      // "리스가 비었다"로 오인되므로 명시적으로 알린다(→ fail-open).
      throw new TelegramLeaseUnavailableError(
        "telegram poller lease needs real-user auth (anonymous fallback active)",
      );
    }
    return getFirestore(app);
  }

  return {
    async readLease(projectId: string): Promise<TelegramPollerLease | null> {
      const db = await requireUserDb();
      const snap = await getDoc(doc(db, "projects", projectId));
      if (!snap.exists()) return null;
      const data = snap.data() as Record<string, unknown>;
      return parseTelegramLease(data[TELEGRAM_LEASE_FIELD]);
    },
    async writeLease(
      projectId: string,
      lease: TelegramPollerLease,
    ): Promise<void> {
      const db = await requireUserDb();
      await setDoc(
        doc(db, "projects", projectId),
        { [TELEGRAM_LEASE_FIELD]: lease },
        { merge: true },
      );
    },
    async clearLease(projectId: string): Promise<void> {
      const db = await requireUserDb();
      await setDoc(
        doc(db, "projects", projectId),
        { [TELEGRAM_LEASE_FIELD]: deleteField() },
        { merge: true },
      );
    },
  };
}
