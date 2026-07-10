import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

/**
 * 강의 시청 진도 추적 (Firestore `lectures_progress` 컬렉션).
 *
 * 문서 1개 = (사용자, 강의 slug, YouTube 섹션) 조합의 진도.
 * 규칙(v3/firestore.rules)에서 `userId == request.auth.uid` 인 본인 문서만
 * read/write 하도록 게이팅한다.
 */
export interface LectureProgress {
  userId: string;
  lectureSlug: string;
  youtubeId: string;
  /** 마지막 재생 위치(초). 이어보기 복원에 사용. */
  positionSeconds: number;
  /** 영상 총 길이(초). 완료율 계산·표시용. */
  durationSeconds: number;
  /** 사실상 끝까지 본 경우 true. */
  completed: boolean;
}

/** 완료로 간주하는 시청 비율(끝부분 크레딧/여백 감안). */
export const COMPLETE_RATIO = 0.95;

/** Firestore write 디바운스 간격(ms). 과도한 write 방지. */
export const SAVE_DEBOUNCE_MS = 5000;

/**
 * 진도 문서 ID. Firestore 문서 ID 는 '/' 불가 → 안전 문자로 정규화.
 * youtubeId/slug 는 통상 영숫자+`-_` 이지만 방어적으로 치환한다.
 */
export function progressDocId(
  userId: string,
  lectureSlug: string,
  youtubeId: string
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safe(userId)}__${safe(lectureSlug)}__${safe(youtubeId)}`;
}

/**
 * 주어진 위치/길이로 완료 여부 판정.
 * duration 이 0/미상이면 완료로 보지 않는다.
 */
export function isCompleted(
  positionSeconds: number,
  durationSeconds: number
): boolean {
  if (!durationSeconds || durationSeconds <= 0) return false;
  return positionSeconds / durationSeconds >= COMPLETE_RATIO;
}

/**
 * 이어보기 시작 위치(초). 이미 완료했거나 거의 끝까지 본 경우 처음부터.
 */
export function resumeSeconds(progress: LectureProgress | null): number {
  if (!progress) return 0;
  if (progress.completed) return 0;
  if (isCompleted(progress.positionSeconds, progress.durationSeconds)) return 0;
  // 마지막 몇 초는 되감아 자연스럽게 이어보기.
  return Math.max(0, Math.floor(progress.positionSeconds) - 3);
}

/** 본인 진도 문서를 로드. 없으면 null. */
export async function loadLectureProgress(
  db: Firestore,
  userId: string,
  lectureSlug: string,
  youtubeId: string
): Promise<LectureProgress | null> {
  const ref = doc(
    db,
    "lectures_progress",
    progressDocId(userId, lectureSlug, youtubeId)
  );
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    userId: data.userId,
    lectureSlug: data.lectureSlug,
    youtubeId: data.youtubeId,
    positionSeconds:
      typeof data.positionSeconds === "number" ? data.positionSeconds : 0,
    durationSeconds:
      typeof data.durationSeconds === "number" ? data.durationSeconds : 0,
    completed: data.completed === true,
  };
}

/**
 * 진도 저장(merge). 완료 플래그는 한 번 true 면 유지(뒤로 감아도 미완료로 되돌리지 않음)
 * — 호출부에서 이미 completed 를 OR 처리해 전달하는 것을 권장.
 */
export async function saveLectureProgress(
  db: Firestore,
  input: LectureProgress
): Promise<void> {
  const ref = doc(
    db,
    "lectures_progress",
    progressDocId(input.userId, input.lectureSlug, input.youtubeId)
  );
  await setDoc(
    ref,
    {
      userId: input.userId,
      lectureSlug: input.lectureSlug,
      youtubeId: input.youtubeId,
      positionSeconds: Math.max(0, Math.floor(input.positionSeconds)),
      durationSeconds: Math.max(0, Math.floor(input.durationSeconds)),
      completed: input.completed,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
