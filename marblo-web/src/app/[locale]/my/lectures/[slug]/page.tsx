"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import VideoPlayer from "@/components/VideoPlayer";
import {
  isCompleted,
  resumeSeconds,
  saveLectureProgress,
  SAVE_DEBOUNCE_MS,
  type LectureProgress,
} from "@/lib/lectureProgress";

interface LectureSection {
  title: string;
  youtubeId: string;
  duration: number;
}

interface LectureModule {
  title: string;
  sections: LectureSection[];
}

interface Lecture {
  title_ko: string;
  title_en: string;
  modules: LectureModule[];
}

export default function WatchLecturePage() {
  const locale = useLocale();
  const t = useTranslations("lectures");
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [currentSection, setCurrentSection] = useState<LectureSection | null>(
    null
  );
  const [authorized, setAuthorized] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  // youtubeId -> 진도. 이어보기 시작 위치 + 사이드바 완료/진행 배지에 사용.
  const [progressMap, setProgressMap] = useState<
    Record<string, LectureProgress>
  >({});

  // 마지막 write 시각(youtubeId 별) — 과도한 Firestore write 디바운스.
  const lastSaveRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push(`/${locale}/auth/login`);
        return;
      }
      // 결제 게이팅: 구매 기록이 있어야 재생 (무회귀 — 기존 로직 유지).
      const q = query(
        collection(db, "lecturePurchases"),
        where("userId", "==", user.uid),
        where("lectureSlug", "==", slug)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        router.push(`/${locale}/lectures/${slug}`);
        return;
      }
      setUid(user.uid);
      setAuthorized(true);

      const lectureDoc = await getDoc(doc(db, "lectures", slug));
      if (lectureDoc.exists()) {
        const data = lectureDoc.data() as Lecture;
        setLecture(data);
        if (data.modules?.[0]?.sections?.[0])
          setCurrentSection(data.modules[0].sections[0]);
      }

      // 본인·이 강의의 진도 문서 일괄 로드(규칙상 본인 문서만 조회 허용).
      try {
        const pSnap = await getDocs(
          query(
            collection(db, "lectures_progress"),
            where("userId", "==", user.uid),
            where("lectureSlug", "==", slug)
          )
        );
        const map: Record<string, LectureProgress> = {};
        pSnap.forEach((d) => {
          const v = d.data();
          if (typeof v.youtubeId === "string") {
            map[v.youtubeId] = {
              userId: v.userId,
              lectureSlug: v.lectureSlug,
              youtubeId: v.youtubeId,
              positionSeconds:
                typeof v.positionSeconds === "number" ? v.positionSeconds : 0,
              durationSeconds:
                typeof v.durationSeconds === "number" ? v.durationSeconds : 0,
              completed: v.completed === true,
            };
          }
        });
        setProgressMap(map);
      } catch {
        /* 진도 로드 실패는 재생 자체를 막지 않는다 */
      }
    });
    return () => unsub();
  }, [locale, router, slug]);

  const persist = useCallback(
    (
      youtubeId: string,
      position: number,
      duration: number,
      forceCompleted: boolean
    ) => {
      if (!uid) return;
      const prev = progressMap[youtubeId];
      const completed =
        forceCompleted ||
        prev?.completed === true ||
        isCompleted(position, duration);
      const next: LectureProgress = {
        userId: uid,
        lectureSlug: slug,
        youtubeId,
        positionSeconds: position,
        durationSeconds: duration || prev?.durationSeconds || 0,
        completed,
      };
      // 메모리 맵은 즉시 갱신(배지 반영).
      setProgressMap((m) => ({ ...m, [youtubeId]: next }));
      // Firestore write 디바운스: 완료 전환이 아니면 SAVE_DEBOUNCE_MS 간격 이상일 때만.
      const now = Date.now();
      const last = lastSaveRef.current[youtubeId] ?? 0;
      const completedTransition = completed && prev?.completed !== true;
      if (!completedTransition && now - last < SAVE_DEBOUNCE_MS) return;
      lastSaveRef.current[youtubeId] = now;
      saveLectureProgress(db, next).catch(() => {
        /* 저장 실패는 조용히 무시(다음 emit 에서 재시도) */
      });
    },
    [uid, slug, progressMap]
  );

  const handleProgress = useCallback(
    (currentSeconds: number, durationSeconds: number) => {
      if (!currentSection) return;
      persist(currentSection.youtubeId, currentSeconds, durationSeconds, false);
    },
    [currentSection, persist]
  );

  const handleEnded = useCallback(
    (durationSeconds: number) => {
      if (!currentSection) return;
      persist(currentSection.youtubeId, durationSeconds, durationSeconds, true);
    },
    [currentSection, persist]
  );

  const startSeconds = useMemo(
    () =>
      currentSection
        ? resumeSeconds(progressMap[currentSection.youtubeId] ?? null)
        : 0,
    // progressMap 은 재생 중 자주 바뀌므로 섹션 전환 시점의 값만 참조.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSection?.youtubeId]
  );

  if (!authorized || !lecture) {
    return <div className="py-24 text-center text-zinc-400">Loading...</div>;
  }

  const title = locale === "ko" ? lecture.title_ko : lecture.title_en;

  return (
    <div className="py-12 px-4">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {currentSection && (
            <VideoPlayer
              key={currentSection.youtubeId}
              youtubeId={currentSection.youtubeId}
              title={currentSection.title}
              startSeconds={startSeconds}
              onProgress={handleProgress}
              onEnded={handleEnded}
            />
          )}
          <h2 className="text-xl font-semibold mt-6">
            {currentSection?.title}
          </h2>
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-bold">{title}</h2>
          {lecture.modules?.map((mod, i) => (
            <div
              key={i}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
            >
              <h3 className="font-semibold mb-3 text-sm text-zinc-300">
                {mod.title}
              </h3>
              <ul className="space-y-2">
                {mod.sections.map((sec, j) => {
                  const p = progressMap[sec.youtubeId];
                  const done = p?.completed === true;
                  const ratio =
                    p && p.durationSeconds > 0
                      ? Math.min(1, p.positionSeconds / p.durationSeconds)
                      : 0;
                  const active = currentSection?.youtubeId === sec.youtubeId;
                  return (
                    <li key={j}>
                      <button
                        onClick={() => setCurrentSection(sec)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                          active
                            ? "bg-indigo-600/20 text-indigo-400"
                            : "text-zinc-400 hover:bg-zinc-800"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1">{sec.title}</span>
                          {done && (
                            <span className="text-[11px] text-emerald-400 shrink-0">
                              ✓ {t("completed")}
                            </span>
                          )}
                        </div>
                        {!done && ratio > 0 && (
                          <div className="mt-1.5 h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
                            <div
                              className="h-full bg-indigo-500"
                              style={{ width: `${Math.round(ratio * 100)}%` }}
                            />
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
