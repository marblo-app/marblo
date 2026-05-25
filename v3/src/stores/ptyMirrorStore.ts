import { create } from "zustand";

/**
 * sessionId 별로 PTY 출력의 마지막 N줄을 ring buffer 로 미러링한다.
 * Fleet 그리드 셀의 MiniTerminal 이 이 store 를 구독해서 라이브 프리뷰를
 * 그리는 데이터 소스. xterm 풀 인스턴스를 띄우는 비용을 피한다.
 *
 * 구현 노트
 * - electronAPI.pty.onData 는 ipcRenderer.on 으로 채널을 다중 구독 가능 →
 *   TerminalView 가 이미 같은 채널을 듣고 있어도 충돌 없이 추가 listener 가
 *   동작한다 (electron/pty-manager.ts:98, electron/preload.ts:47).
 * - 단, pty.removeListeners(id) 는 채널의 모든 listener 를 제거한다.
 *   그래서 본 store 는 attach 시점에 register 만 하고, 풀린 경우 grid 가
 *   remount 될 때 reattach 로 복구한다.
 * - flush 는 50ms debounce — 페인트 폭주 방지. selector 단위 구독으로
 *   sessionId 가 다른 셀은 재렌더되지 않는다.
 */

const DEFAULT_CAPACITY = 12;
const FLUSH_INTERVAL_MS = 50;

interface SessionBuffer {
  // 마지막 N줄을 보관하는 ring buffer. 새 줄이 들어오면 가장 오래된 줄을 폐기.
  lines: string[];
  // pending: 아직 flush 안 된 raw 청크들. 한 줄이 여러 청크로 도착할 수 있어
  // 줄바꿈 도착 시까지 라인 합쳐서 보관한다.
  pendingTail: string;
  capacity: number;
  // monotonic increment — selector 비교에 사용 (lines 배열 동일성보다 정확).
  rev: number;
}

interface PtyMirrorState {
  buffers: Record<string, SessionBuffer>;
  // 활성 sessionId 집합. 다시 마운트될 때 reattach 결정에 사용.
  attached: Record<string, boolean>;

  attach: (sessionId: string, capacity?: number) => void;
  detach: (sessionId: string) => void;
  reset: (sessionId: string) => void;
  // 외부에서 직접 데이터 주입 (test 용 + replay 흐름에서 활용).
  ingest: (sessionId: string, chunk: string) => void;
  getLines: (sessionId: string) => string[];
}

// PTY raw chunk → 라인 단위로 쪼개기. CR-only 캐리지 리턴은 같은 줄 덮어쓰기로
// 처리 — MiniTerminal 단에서 ANSI strip 과 함께 한 번 더 정규화한다.
function appendChunkToBuffer(buf: SessionBuffer, chunk: string): SessionBuffer {
  // \r\n → \n 정규화, 단독 \r 은 보존(아래에서 라인 덮어쓰기 의미 살림).
  const text = buf.pendingTail + chunk.replace(/\r\n/g, "\n");
  const parts = text.split("\n");
  const completed = parts.slice(0, -1);
  const tail = parts[parts.length - 1];

  if (completed.length === 0) {
    return { ...buf, pendingTail: tail, rev: buf.rev };
  }

  const next = buf.lines.slice();
  for (const raw of completed) {
    // 단독 \r 이 있으면 그 뒤 텍스트가 같은 줄을 덮어쓴 결과만 보관.
    const lastCr = raw.lastIndexOf("\r");
    const line = lastCr >= 0 ? raw.slice(lastCr + 1) : raw;
    next.push(line);
  }

  while (next.length > buf.capacity) next.shift();

  return { ...buf, lines: next, pendingTail: tail, rev: buf.rev + 1 };
}

// per-session 청크 큐 + debounce flush. set 호출을 한 프레임에 묶어 페인트
// 비용을 절감.
const pendingChunks = new Map<string, string[]>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleFlush(
  sessionId: string,
  apply: (sessionId: string) => void,
): void {
  if (flushTimers.has(sessionId)) return;
  const timer = setTimeout(() => {
    flushTimers.delete(sessionId);
    apply(sessionId);
  }, FLUSH_INTERVAL_MS);
  flushTimers.set(sessionId, timer);
}

export const usePtyMirrorStore = create<PtyMirrorState>((set, get) => {
  const applyFlush = (sessionId: string) => {
    const queue = pendingChunks.get(sessionId);
    if (!queue || queue.length === 0) return;
    pendingChunks.set(sessionId, []);
    const combined = queue.join("");
    set((s) => {
      const buf = s.buffers[sessionId];
      if (!buf) return s;
      const nextBuf = appendChunkToBuffer(buf, combined);
      return { buffers: { ...s.buffers, [sessionId]: nextBuf } };
    });
  };

  return {
    buffers: {},
    attached: {},

    attach: (sessionId, capacity = DEFAULT_CAPACITY) => {
      const state = get();
      if (state.attached[sessionId]) return; // 이미 listener 등록됨
      set((s) => ({
        attached: { ...s.attached, [sessionId]: true },
        buffers: s.buffers[sessionId]
          ? s.buffers
          : {
              ...s.buffers,
              [sessionId]: {
                lines: [],
                pendingTail: "",
                capacity,
                rev: 0,
              },
            },
      }));

      // electronAPI 가 없는 환경(test/SSR) 에서는 ingest 만으로도 동작.
      const api =
        typeof window !== "undefined"
          ? (
              window as unknown as {
                electronAPI?: {
                  pty?: {
                    onData?: (id: string, cb: (data: string) => void) => void;
                  };
                };
              }
            ).electronAPI
          : undefined;
      if (!api?.pty?.onData) return;

      api.pty.onData(sessionId, (data) => {
        const queue = pendingChunks.get(sessionId) ?? [];
        queue.push(data);
        pendingChunks.set(sessionId, queue);
        scheduleFlush(sessionId, applyFlush);
      });
    },

    detach: (sessionId) => {
      // pty.removeListeners 는 채널 전체(TerminalView 포함)를 비우는 destructive
      // 호출이라 여기서 부르지 않는다. 이미 등록된 ipcRenderer 리스너는 세션이
      // 살아있는 한 그대로 둔다.
      //
      // 따라서 attached 플래그도 클리어하지 않는다 — 그게 "리스너가 등록됐는가"
      // 의 단일 source of truth이고, 클리어해버리면 다음 attach()가 두 번째
      // 리스너를 새로 등록해 같은 청크가 N번 미러된다 (MiniTerminal mount /
      // unmount / remount 시 회귀). 진짜 unsubscribe 는 PTY exit / agent delete
      // 시점에 별도 release() 로 처리해야 함 — TODO.
      //
      // detach 가 정리하는 건 "이 시점에 더 그릴 필요 없는 일시적 상태"뿐:
      //   - pending 청크 큐 + 예약된 flush timer
      // buffer 자체는 살려둔다 — 재마운트 시 빈 화면 깜빡임을 피하기 위해.
      const t = flushTimers.get(sessionId);
      if (t) {
        clearTimeout(t);
        flushTimers.delete(sessionId);
      }
      pendingChunks.delete(sessionId);
    },

    reset: (sessionId) => {
      set((s) => {
        const buf = s.buffers[sessionId];
        if (!buf) return s;
        return {
          buffers: {
            ...s.buffers,
            [sessionId]: {
              ...buf,
              lines: [],
              pendingTail: "",
              rev: buf.rev + 1,
            },
          },
        };
      });
    },

    ingest: (sessionId, chunk) => {
      // ingest 는 즉시 반영 (test/replay 흐름에서 결정적 결과 필요).
      set((s) => {
        const existing = s.buffers[sessionId] ?? {
          lines: [],
          pendingTail: "",
          capacity: DEFAULT_CAPACITY,
          rev: 0,
        };
        const nextBuf = appendChunkToBuffer(existing, chunk);
        return { buffers: { ...s.buffers, [sessionId]: nextBuf } };
      });
    },

    getLines: (sessionId) => {
      const buf = get().buffers[sessionId];
      return buf ? buf.lines : [];
    },
  };
});

/**
 * React-friendly selector. 같은 sessionId 의 lines 배열이 변하지 않으면
 * referential equality 가 유지되어 셀이 재렌더되지 않는다.
 */
export function selectLines(sessionId: string) {
  return (s: PtyMirrorState) => s.buffers[sessionId]?.lines ?? EMPTY;
}

const EMPTY: string[] = [];
