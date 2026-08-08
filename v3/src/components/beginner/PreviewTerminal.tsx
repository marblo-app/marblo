import { useEffect, useMemo, useRef, useState } from "react";
import {
  previewLoginTranscript,
  type PreviewStage,
} from "../../lib/onboardingPreview";
import type { CliModel } from "../../stores/cliSetupStore";

/**
 * 온보딩 프리뷰의 **로그인 터미널 자리**. 실 PTY 세션이 아니라 대본
 * (`previewLoginTranscript`)을 한 줄씩 재생한다.
 *
 * 왜 xterm 이 아닌가: 프리뷰의 계약이 "부수효과 0" 이다. `TerminalView` 를 쓰려면
 * 실제 세션 id 가 있어야 하고, 그 세션은 `pty:create` 로만 생긴다 — 그 순간
 * 프리뷰는 더 이상 드라이런이 아니다. 여기서 필요한 것도 상호작용이 아니라
 * "이 자리에 CLI 출력이 흐른다" 는 그림이라, 재생만으로 충분하다.
 *
 * 크기·테두리·글꼴은 실제 임베드 터미널과 같은 규격으로 맞춘다(시연 스크린샷이
 * 실물과 달라 보이면 프리뷰의 의미가 없다). 다만 대본 첫 줄에 `[preview]` 표식을
 * 박아 두어 스크린샷만 보고 "진짜 로그인됐다" 고 읽히지는 않게 한다.
 */
export function PreviewTerminal({
  model,
  stage,
}: {
  model: CliModel;
  /** 승인이 끝난 국면에서는 대본을 끝까지 보여준다(전이가 잘리지 않게). */
  stage: PreviewStage;
}) {
  const lines = useMemo(() => previewLoginTranscript(model), [model]);
  const [shown, setShown] = useState(1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const finished = stage === "sample" || stage === "done";

  useEffect(() => {
    if (finished) {
      setShown(lines.length);
      return;
    }
    // 마지막 두 줄(✓ Signed in + 빈 줄)은 인증이 성립할 때까지 남겨 둔다 —
    // 승인 대기 중인데 성공 문구가 먼저 떠 있으면 그림이 거짓말을 한다.
    const upTo = Math.max(lines.length - 2, 1);
    if (shown >= upTo) return;
    const timer = window.setTimeout(() => setShown((n) => n + 1), 420);
    return () => window.clearTimeout(timer);
  }, [shown, lines.length, finished]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div
      ref={boxRef}
      data-testid="beginner-preview-terminal"
      data-preview-model={model}
      className="h-full w-full overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[#a6adc8]"
    >
      {lines.slice(0, shown).map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith("✓")
              ? "text-[#a6e3a1]"
              : line.includes("[preview]")
                ? "text-[#f9e2af]"
                : line.startsWith("$")
                  ? "text-[#cdd6f4]"
                  : undefined
          }
        >
          {line || " "}
        </div>
      ))}
      {!finished && <span className="animate-pulse text-[#cdd6f4]">▊</span>}
    </div>
  );
}
