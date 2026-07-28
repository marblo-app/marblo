import { memo, useEffect, useMemo, useRef } from "react";
import { usePtyMirrorStore } from "../../stores/ptyMirrorStore";
import { stripAnsi } from "../../lib/ansi";
import { MONO_FONT_FAMILY } from "../../lib/monoFont";

interface MiniTerminalProps {
  sessionId: string;
  /** 표시할 최대 줄 수 (기본 8). ptyMirrorStore 의 ring buffer 보다 크면 잘림. */
  maxLines?: number;
  className?: string;
  /** 빈 상태 placeholder. 세션이 막 시작했거나 정지된 경우 표시. */
  placeholder?: string;
}

const EMPTY: string[] = [];

/**
 * xterm 풀 인스턴스 없이 <pre> 만으로 PTY 출력 마지막 N줄을 그린다.
 * - ptyMirrorStore 에 sessionId selector 로 구독 → 다른 셀 변경 시 재렌더 0건
 * - mount 시 attach (idempotent), unmount 시 detach
 * - ANSI 시퀀스는 stripAnsi 로 제거 (컬러는 미니뷰에서 의도적으로 포기 —
 *   가독성/페인트 비용 trade)
 */
function MiniTerminalImpl({
  sessionId,
  maxLines = 8,
  className,
  placeholder = "(no output yet)",
}: MiniTerminalProps) {
  const attach = usePtyMirrorStore((s) => s.attach);
  const detach = usePtyMirrorStore((s) => s.detach);
  const lines = usePtyMirrorStore((s) => s.buffers[sessionId]?.lines ?? EMPTY);

  useEffect(() => {
    attach(sessionId);
    return () => detach(sessionId);
  }, [sessionId, attach, detach]);

  const displayed = useMemo(() => {
    const slice = lines.slice(-maxLines);
    return slice.map((l) => stripAnsi(l));
  }, [lines, maxLines]);

  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    // 최신 줄을 항상 보이게 — 그리드 셀 내부 overflow 가 한정되어 있어
    // scrollTop 만 max 로 밀어주면 충분.
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayed]);

  return (
    <pre
      ref={ref}
      style={{ fontFamily: MONO_FONT_FAMILY }}
      className={
        className ??
        "font-mono text-[10px] leading-tight text-[#a6adc8] bg-[#11111b] " +
          "rounded px-2 py-1.5 h-[88px] overflow-hidden whitespace-pre " +
          "border border-[#1e1e2e]"
      }
    >
      {displayed.length === 0 ? (
        <span className="text-[#45475a] italic">{placeholder}</span>
      ) : (
        displayed.join("\n")
      )}
    </pre>
  );
}

// MiniTerminal 은 sessionId/maxLines 가 같으면 동일 props — 셀별 selector 가
// 외부 변화만 감지하므로 다른 셀 onData 가 들어와도 본 컴포넌트는 재렌더 X.
export const MiniTerminal = memo(MiniTerminalImpl);
export default MiniTerminal;
