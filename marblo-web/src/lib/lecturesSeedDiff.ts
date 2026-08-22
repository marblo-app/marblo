/**
 * 강의 시드 ↔ Firestore 차이 계산 (공용 모듈)
 *
 * seed-lectures.ts(쓰기)와 diff-lectures.ts(읽기 전용)가 같은 비교 로직을 쓰도록
 * 여기 한 곳에만 둔다. 두 스크립트가 서로 다른 판정을 하면 "미리보기와 실제 쓰기가
 * 다르다" 는 사고가 나는데, 프로덕션 결제 페이지 데이터라 그 사고는 허용되지 않는다.
 */
import type { LectureData } from "@/data/lectures";

/** 시드가 관리하지 않는 필드. 비교/쓰기 대상에서 제외한다. */
export const MANAGED_EXCLUDE = new Set(["createdAt", "updatedAt"]);

export type FieldDiff = {
  field: string;
  kind: "added" | "changed";
  before: unknown;
  after: unknown;
};

export type DocDiff = {
  slug: string;
  exists: boolean;
  diffs: FieldDiff[];
  /** Firestore 에만 있고 시드에는 없는 필드(merge:true 라 지워지지 않음 — 참고용) */
  extraInRemote: string[];
};

/** 순서까지 포함한 깊은 동등 비교. 배열 순서는 커리큘럼 순서라 의미가 있다. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    if (!ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

/**
 * 시드 1건이 Firestore 문서에 대해 만들 변경분을 계산한다.
 * remote 가 undefined 면 문서가 없다는 뜻(전 필드 added).
 */
export function computeDocDiff(
  lecture: LectureData,
  remote: Record<string, unknown> | undefined
): DocDiff {
  const { slug, ...desired } = lecture;
  const diffs: FieldDiff[] = [];

  for (const [field, after] of Object.entries(desired)) {
    if (MANAGED_EXCLUDE.has(field)) continue;
    if (!remote || !(field in remote)) {
      diffs.push({ field, kind: "added", before: undefined, after });
      continue;
    }
    const before = remote[field];
    if (!deepEqual(before, after)) {
      diffs.push({ field, kind: "changed", before, after });
    }
  }

  const extraInRemote = remote
    ? Object.keys(remote).filter(
        (k) => !MANAGED_EXCLUDE.has(k) && !(k in desired)
      )
    : [];

  return { slug, exists: Boolean(remote), diffs, extraInRemote };
}

/** 로그용 한 줄 요약. 긴 본문은 잘라서 찍는다(전문은 --verbose). */
export function preview(v: unknown, max = 110): string {
  if (v === undefined) return "(없음)";
  if (typeof v === "string") {
    const s = v.replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }
  if (Array.isArray(v)) {
    const json = JSON.stringify(v);
    return json.length > max
      ? `Array(${v.length}) ${json.slice(0, max)}…`
      : `Array(${v.length}) ${json}`;
  }
  const json = JSON.stringify(v);
  return json && json.length > max ? `${json.slice(0, max)}…` : String(json);
}

/** 사람이 읽는 차이 리포트. dry-run 과 실제 쓰기 양쪽에서 같은 출력을 쓴다. */
export function renderDocDiff(d: DocDiff, verbose = false): string {
  const lines: string[] = [];
  lines.push(`=== lectures/${d.slug} ===`);
  if (!d.exists) {
    lines.push(`  문서 없음 → 신규 생성. 전 필드 ${d.diffs.length}개 기록.`);
  } else if (d.diffs.length === 0) {
    lines.push("  차이 없음 (시드와 완전 일치)");
  } else {
    lines.push(`  변경될 필드 ${d.diffs.length}개:`);
    for (const f of d.diffs) {
      lines.push(`  - ${f.field} [${f.kind === "added" ? "추가" : "변경"}]`);
      if (f.kind === "changed") {
        lines.push(
          `      before: ${
            verbose ? JSON.stringify(f.before) : preview(f.before)
          }`
        );
      }
      lines.push(
        `      after : ${verbose ? JSON.stringify(f.after) : preview(f.after)}`
      );
    }
  }
  if (d.extraInRemote.length > 0) {
    lines.push(
      `  (참고) Firestore 에만 있는 필드 — merge:true 라 삭제되지 않음: ${d.extraInRemote.join(
        ", "
      )}`
    );
  }
  return lines.join("\n");
}
