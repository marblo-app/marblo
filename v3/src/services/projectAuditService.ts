/**
 * 협업 프로젝트 감사 로그 — 캡처(Phase 1) + 조회 API.
 *
 * ─────────────────────────────────────────────────────────────────
 * ★왜 `audit_logs`(기존 원장)에 합치지 않고 컬렉션을 따로 두는가
 * ─────────────────────────────────────────────────────────────────
 * 티켓의 "중복 신설 금지"를 지키려고 먼저 원장 재사용을 검토했고, **접근제어가
 * 정면으로 충돌해서** 분리했다. 근거:
 *
 *   1) firestore.rules 의 `canReadLedgerDoc()` 은 `audit_logs` read 를
 *      **프로젝트 멤버 전원**에게 연다. 우측 ActivityStreamPanel
 *      (services/activityStreamService.ts)이 그걸 그대로 구독한다.
 *      이 티켓이 요구하는 "owner/admin 만 read" 를 audit_logs 에 걸면 일반
 *      멤버의 액티비티 스트림이 통째로 죽는다 — 명백한 회귀.
 *   2) 한 컬렉션을 `kind` 별로 다른 등급으로 게이팅하는 것도 답이 아니다.
 *      Firestore 룰은 쿼리 결과의 **모든** 문서가 통과해야 쿼리를 허용하므로,
 *      클라이언트 쿼리 제약이 룰의 분기와 조금이라도 어긋나는 순간 쿼리 전체가
 *      permission-denied 로 죽는다(#406/#428 에서 이미 겪은 실패 모드).
 *
 * 그래서 **재계측은 하지 않되(중복 회피) 컬렉션은 분리**한다:
 *   - `audit_logs`      = MCP 툴 호출(AI 에이전트 행위). 이미 actorUid 까지
 *                         귀속 기록 중. 이 파일은 **손대지 않는다.**
 *   - `projectAuditLog` = 렌더러발 **사람** 행위. 지금 아무데도 안 잡히는 갭.
 *
 * 머지 이벤트를 여기 안 담는 이유도 같다 — `merge_history` 에 이미 durable
 * 기록이 있고(electron main 의 머지 초크포인트가 write), 그걸 복제하면 정확히
 * "중복 신설"이 된다. 감사 뷰는 두 소스를 함께 읽으면 된다.
 *
 * ─────────────────────────────────────────────────────────────────
 * ★신뢰 경계 (정직한 한계)
 * ─────────────────────────────────────────────────────────────────
 * 이 컬렉션의 writer 는 **렌더러(로그인한 사용자)** 다. 룰이
 * `actorUid == request.auth.uid` + 멤버십을 강제하므로 *남을 사칭한* 기록은
 * 만들 수 없지만, 악의적 멤버가 자기 행위를 **아예 기록하지 않는 것**(패치된
 * 클라이언트로 write 를 생략)은 클라이언트 사이드 캡처로는 막을 수 없다.
 * 즉 이 로그는 "무결한 부인방지 원장"이 아니라 **정상 클라이언트의 행위 기록**
 * 이다. 진짜 강제가 필요하면 캡처가 서버(functions 트리거 / main 프로세스)로
 * 내려가야 하고, 그건 이 슬라이스의 범위 밖이다. 과대평가를 막으려고 여기 적어
 * 둔다.
 */

import { where, orderBy, limit as limitTo } from "firebase/firestore";
import type {
  ProjectAuditEvent,
  ProjectAuditLogQuery,
} from "../types/projectAudit";
import {
  buildProjectAuditEvent,
  normalizeAuditLimit,
  sortAuditEventsDesc,
  type BuildProjectAuditEventInput,
} from "../lib/projectAudit";
import {
  createDocument,
  queryDocuments,
  toTimestamp,
  convertTimestamps,
} from "./firestore";
import { auth } from "../lib/firebase";

const COLLECTION = "projectAuditLog";
const DATE_FIELDS = ["createdAt"];

function toProjectAuditEvent(raw: Record<string, unknown>): ProjectAuditEvent {
  return convertTimestamps<ProjectAuditEvent>(raw, DATE_FIELDS);
}

/**
 * 현재 로그인 사용자. 캡처 지점이 uid 를 직접 들고 있지 않을 때 쓴다.
 *
 * auth 를 만지므로 순수 lib 가 아니라 여기 둔다.
 */
function currentActor(): { uid: string | null; name: string | null } {
  const user = auth.currentUser;
  return {
    uid: user?.uid ?? null,
    name: user?.displayName ?? null,
  };
}

// ── 캡처 (Phase 1) ───────────────────────────────────────────────

/**
 * 감사 이벤트 한 건을 기록한다. **fire-and-forget 이고 절대 throw 하지 않는다.**
 *
 * ★이게 이 함수의 가장 중요한 성질이다. 감사 기록 실패가 원 행위(채팅 전송·
 * 티켓 이동·스폰)를 깨뜨리면 안 된다 — 감사를 켠 것 때문에 제품이 망가지는 건
 * 어떤 감사 요구사항보다도 나쁘다. 그래서 호출부는 `await` 하지 않아도 되고,
 * 실패는 console.warn 으로만 남는다.
 *
 * 반환값이 없는 대신 실패/누락은 전부 warn 으로 드러낸다 — 조용한 유실 금지.
 */
export function recordProjectAuditEvent(
  input: Omit<BuildProjectAuditEventInput, "actorUid" | "actorName"> &
    Partial<Pick<BuildProjectAuditEventInput, "actorUid" | "actorName">>,
): void {
  const actor = currentActor();
  const event = buildProjectAuditEvent({
    ...input,
    actorUid: input.actorUid ?? actor.uid,
    actorName: input.actorName ?? actor.name,
  });

  if (!event) {
    // 귀속 불가(미로그인/projectId 부재). 룰이 어차피 거부하므로 보내지 않는다.
    console.warn(
      "[projectAudit] 귀속 불가로 감사 이벤트를 건너뜀:",
      input.type,
      { projectId: input.projectId, hasActor: !!(input.actorUid ?? actor.uid) },
    );
    return;
  }

  createDocument(COLLECTION, {
    ...event,
    createdAt: toTimestamp(new Date()),
  }).catch((err) => {
    console.warn("[projectAudit] 감사 이벤트 기록 실패:", event.type, err);
  });
}

// ── 조회 API (Project 탭이 소비) ─────────────────────────────────

/**
 * 프로젝트 감사 로그 조회 — 최신순.
 *
 * 권한: firestore.rules 가 owner/admin 으로 게이팅한다. 일반 멤버가 부르면
 * permission-denied 가 그대로 throw 된다(조용히 빈 배열을 돌려주지 않는다 —
 * "권한 없음"과 "기록 없음"은 감사에서 절대 같은 값이면 안 된다).
 *
 * ★필터는 **서버 사이드**다. 기존 auditService.subscribeToAuditLogs 는 limit
 * 로 자른 뒤 클라이언트에서 거르는데, 그러면 "이 구성원의 로그"를 물었을 때
 * 최근 100건 안에 그 사람이 3건뿐이면 3건만 나온다 — 500건이 더 있어도.
 * 구성원별 조회가 이 티켓의 핵심 용례라 그 함정을 답습하지 않았다.
 * 대신 조합별 복합 인덱스가 필요하다(firestore.indexes.json 에 4개 선언).
 */
export async function getProjectAuditLog(
  projectId: string,
  options: ProjectAuditLogQuery = {},
): Promise<ProjectAuditEvent[]> {
  const max = normalizeAuditLimit(options.limit);

  const constraints = [
    where("projectId", "==", projectId),
    ...(options.actorUid ? [where("actorUid", "==", options.actorUid)] : []),
    ...(options.type ? [where("type", "==", options.type)] : []),
    orderBy("createdAt", "desc"),
    limitTo(max),
  ];

  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    ...constraints,
  );
  // 서버가 이미 정렬해 주지만, 한 번 더 접어서 호출부가 순서를 신뢰할 수 있게 한다
  // (목/에뮬레이터 경로에서 orderBy 가 no-op 인 경우 대비).
  return sortAuditEventsDesc(docs.map(toProjectAuditEvent));
}

/**
 * 이 프로젝트에서 감사 로그에 등장한 구성원 uid 목록.
 *
 * 구성원별 필터 UI 를 그리려면 "누가 등장하는가"를 알아야 하는데, 그걸
 * 프로젝트 멤버 전체로 그리면 **기록이 하나도 없는 사람도 필터에 뜬다**.
 * 조회한 창(window) 안에서 실제로 등장한 actor 만 돌려준다 — 즉 이 목록은
 * "전체 구성원"이 아니라 "이 창에 기록이 있는 구성원"이다.
 */
export async function getProjectAuditActors(
  projectId: string,
  options: Pick<ProjectAuditLogQuery, "limit"> = {},
): Promise<
  Array<{ actorUid: string; actorName: string | null; count: number }>
> {
  const events = await getProjectAuditLog(projectId, options);
  const byUid = new Map<
    string,
    { actorUid: string; actorName: string | null; count: number }
  >();
  for (const event of events) {
    const prior = byUid.get(event.actorUid);
    if (prior) {
      prior.count += 1;
      // 이름은 최신 것을 남긴다(개명 반영). events 는 최신순이라 첫 값이 최신.
      prior.actorName = prior.actorName ?? event.actorName;
    } else {
      byUid.set(event.actorUid, {
        actorUid: event.actorUid,
        actorName: event.actorName,
        count: 1,
      });
    }
  }
  return [...byUid.values()].sort((a, b) => b.count - a.count);
}
