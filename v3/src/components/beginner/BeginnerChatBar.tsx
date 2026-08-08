import { useEffect, useRef } from "react";
import { useTranslation } from "../../lib/i18n";
import type { BeginnerAsk } from "../../hooks/useBeginnerAsk";
import { BLOCK, BUTTON_PRIMARY, SURFACE, SectionLabel } from "./beginnerUi";

const EXAMPLE_KEYS = [
  "beginner.ask.example1",
  "beginner.ask.example2",
  "beginner.ask.example3",
] as const;

/**
 * 비기너 셸의 **지속 대화창** — 아래 오케 PTY 로 그대로 흘러가는 컴포저.
 *
 * 예전 `BeginnerFirstAsk` 는 이름 그대로 **첫 요청 한 번**짜리였다: 전달되면
 * 입력칸도 보내기 버튼도 사라지고 초록 확인 한 줄만 남았다. 같은 프롬프트를
 * 연타해 세 번 주입한 지문(진단 §7 P1-2 ①)을 막으려던 장치였는데, 대가로 첫
 * 질문 뒤에 **이어서 말할 곳**이 없어졌다. 시연에서 사장님이 짚은 자리가 정확히
 * 그것이다 — 상단은 오케 터미널과 연결된 대화창이어야 한다.
 *
 * 그래서 이 컴포넌트는 늘 살아 있다. 중복 주입 가드는 사라진 게 아니라 형태를
 * 바꿔 `useBeginnerAsk` 안으로 들어갔다(같은 문장 30초 내 재전송만 차단). 여기서
 * 하는 몫은 둘이다:
 *
 *   - 전달에 성공하면 입력을 **비운다** — 같은 문장이 남아 있으면 연타의 미끼가
 *     된다. 비우는 것 자체가 가드의 1차 방어선이다.
 *   - 첫 전달 뒤에는 안내(제목·설명·예시 칩)를 접는다. "무엇을 쳐야 하나" 는
 *     처음 한 번만 필요한 안내이고, 그 자리를 대화가 이어받아야 한다.
 *
 * 입력 문자열은 셸이 든다(controlled) — 미니 보드의 티켓 상세가 "오케에게
 * 물어보기" 로 이 칸을 채우기 때문이다. 상태가 여기 갇혀 있으면 그 프리필이
 * 닿지 못한다.
 */
export function BeginnerChatBar({
  ask,
  draft,
  onDraftChange,
}: {
  ask: BeginnerAsk;
  draft: string;
  onDraftChange: (next: string) => void;
}) {
  const { t } = useTranslation();

  // 첫 전달 전 = 안내를 펼친 "무엇을 만들까요?" 국면. 이후 = 대화 국면.
  const intro = !ask.locked;

  // ★전달에 성공하면 입력을 비운다 — 보낸 문장이 칸에 그대로 남아 있으면 그게
  // 연타의 미끼가 된다(같은 문장 재전송은 훅의 가드가 막지만, 애초에 유혹을
  // 남기지 않는 편이 낫다). 실패·큐잉은 비우지 않는다: 그 문장은 아직 오케에게
  // 닿지 않았으므로 유저가 곧바로 다시 누를 수 있어야 한다.
  const clearedFor = useRef(0);
  useEffect(() => {
    if (ask.sentCount === 0 || ask.sentCount === clearedFor.current) return;
    clearedFor.current = ask.sentCount;
    onDraftChange("");
  }, [ask.sentCount, onDraftChange]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || ask.sending) return;
    await ask.send(text);
  };

  return (
    <section
      data-testid="beginner-first-ask"
      data-mode={intro ? "intro" : "chat"}
      className={`${SURFACE} ${BLOCK}`}
    >
      {intro ? (
        <>
          <h2 className="text-[15px] font-semibold leading-6 text-[#cdd6f4]">
            {t("beginner.ask.title")}
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-[#7f849c]">
            {t("beginner.ask.body")}
          </p>
        </>
      ) : (
        // 대화 국면의 눈썹 — 이 칸이 아래 오케 대화창과 **한 줄로 이어져 있다**는
        // 사실을 말한다. 유저는 두 입력칸(여기 / PTY)을 보고 어느 쪽이 진짜인지
        // 묻게 되는데, 답은 "같은 곳으로 간다" 이다.
        <SectionLabel
          trailing={
            ask.delivery && (
              <span
                data-testid="beginner-first-ask-result"
                data-delivery={ask.delivery}
                className={
                  ask.delivery === "delivered"
                    ? "text-[#a6e3a1]"
                    : ask.delivery === "queued"
                      ? "text-[#f9e2af]"
                      : "text-[#f38ba8]"
                }
              >
                {ask.delivery === "delivered"
                  ? t("beginner.ask.sentShort")
                  : ask.delivery === "queued"
                    ? t("beginner.ask.queuedShort")
                    : t("beginner.ask.failedShort")}
              </span>
            )
          }
        >
          {t("beginner.chat.composerLabel")}
        </SectionLabel>
      )}

      <textarea
        data-testid="beginner-first-ask-input"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={intro ? 3 : 2}
        disabled={ask.sending}
        placeholder={t(
          intro ? "beginner.ask.placeholder" : "beginner.chat.placeholder",
        )}
        className={`w-full resize-none rounded-md border border-[#313244] bg-[#11111b] px-3 py-2.5 text-sm leading-6 text-[#cdd6f4] placeholder-[#585b70] transition-colors focus:border-[#89b4fa] focus:outline-none disabled:opacity-60 ${
          intro ? "mt-3" : "mt-1.5"
        }`}
      />

      {/* ★예시 칩과 보내기를 한 줄에 둔다. 칩은 첫 국면에만 — 대화가 시작된 뒤에도
          예시가 서 있으면, 지금 나눈 맥락과 무관한 문장이 계속 권해진다. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2">
        {intro &&
          EXAMPLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onDraftChange(t(key))}
              disabled={ask.sending}
              className="rounded-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1 text-[11px] leading-4 text-[#a6adc8] transition-colors hover:border-[#45475a] hover:text-[#cdd6f4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(key)}
            </button>
          ))}

        {/* 같은 문장을 너무 빨리 다시 보내려 했을 때. 조용히 삼키면 유저는 앱이
            멈춘 줄 안다 — 막았다는 사실과 이유를 그 자리에서 말한다. */}
        {ask.duplicateBlocked && (
          <p
            data-testid="beginner-ask-duplicate"
            className="min-w-0 flex-1 text-[11px] leading-4 text-[#f9e2af]"
          >
            {t("beginner.ask.duplicate")}
          </p>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          <kbd className="hidden font-sans text-[10px] text-[#585b70] sm:inline">
            ⌘↵
          </kbd>
          <button
            type="button"
            data-testid="beginner-first-ask-send"
            onClick={() => void submit()}
            disabled={ask.sending || !draft.trim()}
            className={BUTTON_PRIMARY}
          >
            {ask.sending ? t("beginner.ask.sending") : t("beginner.ask.send")}
          </button>
        </div>
      </div>

      {/* 첫 전달의 결과만 카드 안에 한 줄로 남긴다(대화 국면에선 위 눈썹이 든다).
          "전달했어요 — 아래에서 진행 상황이 보입니다" 가 시선을 스트립으로 넘긴다. */}
      {intro && ask.delivery && (
        <p
          data-testid="beginner-first-ask-result"
          data-delivery={ask.delivery}
          className={`mt-3 flex items-center gap-1.5 text-xs leading-5 ${
            ask.delivery === "delivered"
              ? "text-[#a6e3a1]"
              : ask.delivery === "queued"
                ? "text-[#f9e2af]"
                : "text-[#f38ba8]"
          }`}
        >
          <span aria-hidden>{ask.delivery === "delivered" ? "✓" : "!"}</span>
          {ask.delivery === "delivered"
            ? t("beginner.ask.sent")
            : ask.delivery === "queued"
              ? t("beginner.ask.queued")
              : t("beginner.ask.failed")}
        </p>
      )}
    </section>
  );
}
