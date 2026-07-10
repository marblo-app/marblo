"use client";

import { useEffect, useRef } from "react";

interface VideoPlayerProps {
  youtubeId: string;
  title: string;
  /** 이어보기 시작 위치(초). */
  startSeconds?: number;
  /** 재생 중 주기적으로 + 일시정지/종료 시점에 호출. write 는 호출부에서 디바운스. */
  onProgress?: (currentSeconds: number, durationSeconds: number) => void;
  /** 영상이 끝까지 재생되면 호출. */
  onEnded?: (durationSeconds: number) => void;
}

/** 재생 중 진도 방출 주기(ms). 과도한 Firestore write 를 막는 1차 디바운스. */
const EMIT_INTERVAL_MS = 10000;

// --- 최소 YT IFrame API 타입 (@types/youtube 미설치) ---
interface YTPlayer {
  getCurrentTime: () => number;
  getDuration: () => number;
  getIframe: () => HTMLIFrameElement;
  destroy: () => void;
}
interface YTStateEvent {
  data: number;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** IFrame API 스크립트를 한 번만 로드하고, 준비되면 resolve. */
let ytApiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement("script");
    // nocookie 도메인의 API 스크립트(프라이버시 강화 모드).
    tag.src = "https://www.youtube-nocookie.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

export default function VideoPlayer({
  youtubeId,
  title,
  startSeconds = 0,
  onProgress,
  onEnded,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 최신 콜백을 ref 로 유지해 player 재생성을 막는다.
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);
  onProgressRef.current = onProgress;
  onEndedRef.current = onEnded;

  useEffect(() => {
    let player: YTPlayer | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const emit = () => {
      if (!player) return;
      try {
        onProgressRef.current?.(player.getCurrentTime(), player.getDuration());
      } catch {
        /* player 파괴 직후 등 — 무시 */
      }
    };
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      const mount = document.createElement("div");
      containerRef.current.appendChild(mount);

      player = new YT.Player(mount, {
        videoId: youtubeId,
        // host 를 nocookie 로 지정 → 임베드가 youtube-nocookie.com 로 로드.
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "100%",
        playerVars: {
          rel: 0,
          cc_load_policy: 1,
          start: Math.max(0, Math.floor(startSeconds)),
          playsinline: 1,
        },
        events: {
          onReady: () => {
            try {
              player?.getIframe().setAttribute("title", title);
            } catch {
              /* noop */
            }
          },
          onStateChange: (e: YTStateEvent) => {
            const state = YT.PlayerState;
            if (e.data === state.PLAYING) {
              stopPolling();
              interval = setInterval(emit, EMIT_INTERVAL_MS);
            } else if (e.data === state.PAUSED) {
              stopPolling();
              emit();
            } else if (e.data === state.ENDED) {
              stopPolling();
              emit();
              try {
                onEndedRef.current?.(player?.getDuration() ?? 0);
              } catch {
                /* noop */
              }
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      stopPolling();
      // 언마운트/섹션 전환 시 마지막 위치를 한 번 저장.
      emit();
      try {
        player?.destroy();
      } catch {
        /* noop */
      }
      player = null;
    };
    // youtubeId 변경 시에만 player 재생성. startSeconds 는 마운트 시점 값 사용.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId]);

  return (
    <div className="aspect-video w-full rounded-xl overflow-hidden bg-zinc-900">
      <div ref={containerRef} className="w-full h-full" aria-label={title} />
    </div>
  );
}
