import { where, orderBy, limit, type Unsubscribe } from "firebase/firestore";
import { subscribeToCollection, convertTimestamps } from "./firestore";
import type { MergeHistoryEntry } from "../types/mergeHistory";

const COLLECTION = "merge_history";
const DATE_FIELDS = ["mergedAt"];

function toEntry(raw: Record<string, unknown>): MergeHistoryEntry {
  return convertTimestamps<MergeHistoryEntry>(raw, DATE_FIELDS);
}

/**
 * Live-subscribe to the merge-history audit trail, newest first. The cockpit is
 * cross-project, so scope is optional. Three shapes:
 *  - `projectId`    → single project (`where projectId ==`).
 *  - `projectIds`   → the caller's member projects (`where projectId in [...]`,
 *                     max 30). Use this for the cross-project cockpit view.
 *  - neither        → unscoped (`orderBy` only), every project.
 *
 * ★L2 보안 주의(firestore.rules merge_history): read 가 isProjectMember 로 조여지면
 * **unscoped 쿼리는 Firestore 가 permission-denied 로 통째 거부한다** — 비멤버
 * 문서를 포함할 수 있는 쿼리는 룰이 허용하지 않기 때문이다. 룰 배포 후 코크핏
 * 크로스프로젝트 뷰는 반드시 `projectIds`(사용자가 속한 프로젝트 목록)로 스코프해야
 * 한다. unscoped 경로는 룰이 아직 느슨한(구) 환경 또는 admin 전용 경로에서만 안전하다.
 *
 * 인덱스: 단일/`in` 스코프 경로 모두 (projectId ASC, mergedAt DESC) 복합 인덱스를
 * 재사용한다(firestore.indexes.json 에 이미 선언됨). unscoped 경로는 단일필드 인덱스.
 */
export function subscribeToMergeHistory(
  callback: (entries: MergeHistoryEntry[]) => void,
  options?: { projectId?: string; projectIds?: string[]; maxResults?: number },
): Unsubscribe {
  // projectIds(멤버 프로젝트 목록)가 우선. Firestore `in` 은 최대 30개까지만
  // 허용하므로 넘치면 앞의 30개로 자른다(코크핏은 최신순 limit 로 다시 좁혀진다).
  const scoped =
    options?.projectIds && options.projectIds.length > 0
      ? [where("projectId", "in", options.projectIds.slice(0, 30))]
      : options?.projectId
        ? [where("projectId", "==", options.projectId)]
        : [];

  const constraints = [
    ...scoped,
    orderBy("mergedAt", "desc"),
    limit(options?.maxResults ?? 200),
  ];

  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    constraints,
    (docs) => callback(docs.map(toEntry)),
  );
}
