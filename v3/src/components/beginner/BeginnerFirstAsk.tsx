import { useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { BeginnerAsk } from "../../hooks/useBeginnerAsk";

const EXAMPLE_KEYS = [
  "beginner.ask.example1",
  "beginner.ask.example2",
  "beginner.ask.example3",
] as const;

/**
 * 비기너의 첫 요청 — 오케 대화창 위에 얹히는 큰 입력칸.
 *
 * 오케 PTY 에도 입력줄이 있지만, 첫 화면의 신규 유저는 "저기다 뭘 쳐야 하나"를
 * 모른다. 그래서 첫 전달 **전에만** 이 카드를 띄우고, 전달되고 나면 잠긴다(이후
 * 대화는 아래 대화창에서 이어간다).
 *
 * 전송·잠금·재전송 규칙은 전부 `useBeginnerAsk` 가 들고 있다 — 막힘 안내의
 * "다시 보내기"(BeginnerLiveStrip)와 **같은 전송**을 공유해야 하기 때문이다.
 * 이 컴포넌트는 그 상태를 그리기만 한다.
 */
export function BeginnerFirstAsk({ ask }: { ask: BeginnerAsk }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");

  return (
    <section
      data-testid="beginner-first-ask"
      className="rounded-lg border border-[#313244] bg-[#181825] p-4"
    >
      {/* ★전달된 뒤에는 입력도 안내문도 사라지고 초록 확인 한 줄만 남는다 —
          같은 프롬프트를 다시 주입하는 연타(진단 §S4)의 직접 차단이자, 시선을
          아래 라이브 스트립으로 넘기는 장치다. 재전송은 막힘 안내의 CTA 로만. */}
      {!ask.locked && (
        <>
          <h2 className="text-base font-semibold text-[#cdd6f4]">
            {t("beginner.ask.title")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
            {t("beginner.ask.body")}
          </p>

          <textarea
            data-testid="beginner-first-ask-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void ask.send(text);
              }
            }}
            rows={3}
            disabled={ask.sending}
            placeholder={t("beginner.ask.placeholder")}
            className="mt-3 w-full resize-none rounded-md border border-[#45475a] bg-[#11111b] px-3 py-2.5 text-sm text-[#cdd6f4] placeholder-[#585b70] focus:border-[#89b4fa] focus:outline-none disabled:opacity-60"
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {EXAMPLE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setText(t(key))}
                disabled={ask.sending}
                className="rounded-full border border-[#45475a] px-2.5 py-1 text-[11px] text-[#a6adc8] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4] disabled:opacity-60"
              >
                {t(key)}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="beginner-first-ask-send"
            onClick={() => void ask.send(text)}
            disabled={ask.sending || !text.trim()}
            className="mt-3 w-full rounded-md bg-[#a6e3a1] px-3 py-2.5 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#94e2d5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ask.sending ? t("beginner.ask.sending") : t("beginner.ask.send")}
          </button>
        </>
      )}

      {ask.delivery && (
        <p
          data-testid="beginner-first-ask-result"
          data-delivery={ask.delivery}
          className={`text-xs ${ask.locked ? "" : "mt-3"} ${
            ask.delivery === "delivered"
              ? "text-[#a6e3a1]"
              : ask.delivery === "queued"
                ? "text-[#f9e2af]"
                : "text-[#f38ba8]"
          }`}
        >
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
