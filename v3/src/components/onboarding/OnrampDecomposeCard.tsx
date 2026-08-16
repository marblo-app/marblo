import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { AgentRole } from "../../types/task";
import {
  ONRAMP_DECOMPOSE_LIMIT,
  clampDrafts,
  ruleDecomposer,
  type TicketDraft,
} from "../../lib/onrampDecompose";
import { createOnrampDemoTickets } from "../../services/onrampDemoTickets";
import { reportOnrampExecBlocked } from "../../services/onrampBlockSignal";
import telemetry from "../../services/telemetryService";
import { ORCHESTRATOR_CLI_IDS, ROWS } from "../../stores/cliSetupStore";
import { useOnrampStore } from "../../stores/onrampStore";
import { useProjectStore } from "../../stores/projectStore";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";

/**
 * L0 — "내 말이 카드가 된다" (설계 v3/docs/onramp-ladder-design-2026-08-09.md §4).
 *
 * ★캔드 데모(`DemoMode`)와 **역할이 다르다.** 데모는 남의 대본을 **본다**,
 * 이 카드는 자기 문장으로 **만든다**. 설계 §4-B 가 B(룰 분해)를 고른 이유가 정확히
 * 그것이다 — "내가 방금 쓴 문장이 카드 여섯 장이 되어 보드에 꽂혔다" 는 아하는
 * 시청형 데모에 **구조적으로 없다**. 그래서 두 표면은 중복이 아니고, 문구도 그
 * 경계를 말한다(R4).
 *
 * ★티켓은 진짜다(불변식 I3). 프리뷰 배열이 아니라 실제 `tasks` 컬렉션에 쓰고,
 * 계정을 연결하면 그대로 실행된다. 가짜 보드였다면 유저는 같은 말을 두 번 해야
 * 한다 — 그게 사다리를 사다리가 아니게 만든다.
 *
 * ★원가는 0이다. 분해는 `lib/onrampDecompose` 의 **순수 룰**이라 LLM 호출도
 * 서버 표면도 없다(설계 §4-A B안). 이 파일이 만드는 유일한 원격 호출은 티켓
 * write(Firestore)뿐이고, 그건 이미 L0 유저에게 열려 있는 권한이다.
 *
 * 두 셸이 같은 컴포넌트를 마운트한다(비기너 연결 게이트 / 어드밴스드 시작하기
 * 탭). 한쪽에만 달면 그 모드 유저만 0층이 없는 반쪽 온보딩을 받는다.
 */

const ROLE_KEY: Record<AgentRole, MessageKey> = {
  frontend: "onramp.decompose.role.frontend",
  backend: "onramp.decompose.role.backend",
  test: "onramp.decompose.role.test",
  devops: "onramp.decompose.role.devops",
};

const EXAMPLE_KEYS: MessageKey[] = [
  "onramp.decompose.example1",
  "onramp.decompose.example2",
  "onramp.decompose.example3",
];

type Phase = "idle" | "working" | "done" | "failed" | "partial";

export interface OnrampDecomposeCardProps {
  /** 계측 surface — beginner_connect | start_here_tab. */
  surface: string;
  /** 어드밴스드에서 "보드에서 보기" 를 누를 수 있으면 넘긴다. */
  onOpenBoard?: () => void;
}

export function OnrampDecomposeCard({
  surface,
  onOpenBoard,
}: OnrampDecomposeCardProps) {
  const { t, locale: appLocale } = useTranslation();
  const setup = useOnboardingSetup();
  const projectId = useProjectStore((s) => s.currentProject?.id ?? "");
  const decomposeCount = useOnrampStore((s) => s.decomposeCount);
  const demoTicketCount = useOnrampStore((s) => s.demoTicketCount);
  const recordDecompose = useOnrampStore((s) => s.recordDecompose);
  const quota = useOnrampStore((s) => s.quota);

  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [created, setCreated] = useState<TicketDraft[]>([]);
  const [fallback, setFallback] = useState(false);

  // 룰 모듈은 자기 문자열을 들고 있으므로(유저 어휘와 합성되기 때문 — 설계 §4-C
  // D1) 화면의 로케일을 인자로 넘긴다.
  const locale = appLocale === "en" ? "en" : "ko";
  const verdict = quota();
  const remaining = Math.max(0, ONRAMP_DECOMPOSE_LIMIT - decomposeCount);

  /**
   * 차단 안내에 이름을 실을 CLI. 오케 후보(claude/codex) 중 첫 행을 쓴다 —
   * `fundingProbeTarget` 이 같은 우선순위를 쓰는 것과 같은 이유다(오케를 실제로
   * 돌릴 CLI 의 상태가 사용자가 겪는 진실이다).
   */
  const blockTarget = useMemo(() => {
    const rowId = ORCHESTRATOR_CLI_IDS[0];
    const row = ROWS.find((r) => r.id === rowId);
    const results = setup.results ?? {};
    return {
      model: row?.model ?? "claude",
      installed: results[rowId]?.installed === true,
    };
  }, [setup.results]);

  const decompose = useCallback(async () => {
    const text = draft.trim();
    if (!text || phase === "working") return;

    // ★한도 초과를 **조용한 실패로 만들지 않는다**(설계 §4-F). 한도 도달 자체가
    // 전환 트리거이므로 그 자리에서 M1 을 띄운다.
    const gate = quota();
    if (!gate.allowed) {
      reportOnrampExecBlocked(
        {
          model: blockTarget.model,
          action: "",
          installed: blockTarget.installed,
        },
        "decompose_limit",
      );
      return;
    }

    setPhase("working");
    const result = ruleDecomposer(text, locale);
    const drafts = clampDrafts(result.drafts, gate.remainingTickets);
    setFallback(result.fallback);

    // 폴더가 아직 없으면 보드가 없다 — 만들 수 없다고 말한다(조용한 실패 금지).
    if (!projectId) {
      setPhase("failed");
      telemetry.onrampDecomposeUsed({
        mode: "rule",
        matchedRule: result.matchedRule,
        fallback: result.fallback,
        ticketCount: drafts.length,
        persisted: false,
        surface,
      });
      return;
    }

    const outcome = await createOnrampDemoTickets(projectId, drafts, {
      matchedRule: result.matchedRule,
      fallback: result.fallback,
    });

    const persistedCount = outcome.createdIds.length;
    // ★만든 만큼만 한도에 적는다. 한 장도 못 만들었으면 **횟수도 안 깎는다** —
    // 오프라인·권한 오류로 실패한 시도가 유저의 3회 중 하나를 먹으면, 우리 잘못
    // 으로 유저의 무료 칸이 줄어드는 셈이다.
    if (persistedCount > 0) recordDecompose(persistedCount);
    telemetry.onrampDecomposeUsed({
      mode: "rule",
      matchedRule: result.matchedRule,
      fallback: result.fallback,
      ticketCount: persistedCount,
      persisted: persistedCount > 0,
      surface,
    });

    setCreated(drafts.slice(0, persistedCount));
    setPhase(
      persistedCount === 0 ? "failed" : outcome.partial ? "partial" : "done",
    );
    if (persistedCount > 0) setDraft("");
  }, [
    draft,
    phase,
    quota,
    locale,
    projectId,
    surface,
    recordDecompose,
    blockTarget,
  ]);

  const requestRun = useCallback(() => {
    reportOnrampExecBlocked(
      {
        model: blockTarget.model,
        action: "",
        installed: blockTarget.installed,
      },
      "demo_ticket_run",
    );
  }, [blockTarget]);

  const preparing = setup.sampleStatus === "preparing" && !projectId;
  const working = phase === "working";

  return (
    <section
      data-testid="onramp-decompose"
      data-phase={phase}
      data-fallback={fallback}
      className="rounded-lg border border-[#89b4fa]/30 bg-[#89b4fa]/5 p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm font-semibold text-[#cdd6f4]">
          {t("onramp.decompose.title")}
        </h2>
        <span className="text-[11px] text-[#7f849c]">
          {t("onramp.decompose.zeroCost")}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
        {t("onramp.decompose.body")}
      </p>

      {/* 한도 소진 — 입력칸을 남겨 두면 눌러도 아무 일이 안 일어난다. */}
      {!verdict.allowed ? (
        <div
          data-testid="onramp-decompose-limit"
          className="mt-3 rounded-md border border-[#f9e2af]/30 bg-[#f9e2af]/5 px-3 py-2.5"
        >
          <p className="text-xs font-medium text-[#f9e2af]">
            {t("onramp.decompose.limitTitle")}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[#a6adc8]">
            {t("onramp.decompose.limitBody")}
          </p>
          <button
            type="button"
            data-testid="onramp-decompose-limit-cta"
            onClick={requestRun}
            className="mt-2 inline-flex h-7 items-center rounded-md bg-[#89b4fa] px-2.5 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
          >
            {t("onramp.decompose.limitCta")}
          </button>
        </div>
      ) : (
        <>
          <textarea
            data-testid="onramp-decompose-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void decompose();
              }
            }}
            rows={2}
            disabled={working}
            placeholder={t("onramp.decompose.placeholder")}
            className="mt-3 w-full resize-none rounded-md border border-[#313244] bg-[#11111b] px-3 py-2 text-sm leading-6 text-[#cdd6f4] placeholder-[#585b70] transition-colors focus:border-[#89b4fa] focus:outline-none disabled:opacity-60"
          />

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
            {EXAMPLE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setDraft(t(key))}
                disabled={working}
                className="rounded-full border border-[#313244] bg-[#1e1e2e] px-2.5 py-1 text-[11px] leading-4 text-[#a6adc8] transition-colors hover:border-[#45475a] hover:text-[#cdd6f4] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(key)}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2.5">
              <span className="text-[11px] text-[#585b70]">
                {t("onramp.decompose.remaining", { count: remaining })}
              </span>
              <button
                type="button"
                data-testid="onramp-decompose-cta"
                onClick={() => void decompose()}
                disabled={working || !draft.trim()}
                className="inline-flex h-8 items-center rounded-md bg-[#89b4fa] px-3 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working
                  ? t("onramp.decompose.working")
                  : t("onramp.decompose.cta")}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 폴더가 준비 중이면 그렇게 말한다 — 1~2초 뒤 스스로 붙을 폴더인데
          "없다" 고 하면 유저가 네이티브 피커를 열러 간다(#872 와 같은 지문). */}
      {preparing && (
        <p
          data-testid="onramp-decompose-preparing"
          className="mt-2 text-[11px] leading-5 text-[#a6adc8]"
        >
          {t("onramp.decompose.preparing")}
        </p>
      )}

      {phase === "failed" && (
        <p
          data-testid="onramp-decompose-failed"
          className="mt-2 text-[11px] leading-5 text-[#f38ba8]"
        >
          {t(
            projectId
              ? "onramp.decompose.failed"
              : "onramp.decompose.noProject",
          )}
        </p>
      )}

      {(phase === "done" || phase === "partial") && created.length > 0 && (
        <div className="mt-3" data-testid="onramp-decompose-result">
          <p className="text-xs font-medium text-[#a6e3a1]">
            ✓ {t("onramp.decompose.result", { count: created.length })}
          </p>
          <p className="mt-0.5 text-[11px] leading-5 text-[#a6adc8]">
            {t("onramp.decompose.resultHint")}
          </p>
          {phase === "partial" && (
            <p className="mt-1 text-[11px] leading-5 text-[#f9e2af]">
              {t("onramp.decompose.partial")}
            </p>
          )}

          {/* ★정직성 규칙(설계 §4-D): 규칙이 확신 못 했으면 화면이 그렇게 말한다.
              초안을 완성품처럼 팔지 않는 것이 룰베이스의 유일한 방어다. */}
          {fallback && (
            <p
              data-testid="onramp-decompose-fallback-note"
              className="mt-2 rounded-md border border-[#f9e2af]/25 bg-[#f9e2af]/5 px-2.5 py-2 text-[11px] leading-5 text-[#a6adc8]"
            >
              {t("onramp.decompose.fallbackNote")}
            </p>
          )}

          <ul className="mt-2 space-y-1.5">
            {created.map((ticket) => (
              <li
                key={ticket.order}
                className="flex items-start gap-2 rounded-md border border-[#313244] bg-[#11111b] px-2.5 py-2"
              >
                <span className="mt-0.5 shrink-0 rounded bg-[#313244] px-1.5 py-0.5 text-[10px] font-medium text-[#a6adc8]">
                  {t(ROLE_KEY[ticket.role])}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-5 text-[#cdd6f4]">
                  {ticket.title}
                </span>
                {ticket.dependsOnOrder !== undefined && (
                  <span className="mt-0.5 shrink-0 rounded bg-[#f9e2af]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#f9e2af]">
                    {t("onramp.decompose.dependsOn")}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {/* ★연결 전에만 "실행하기" 를 그린다. 이미 연결된 유저에게 이 버튼은
                거짓말이 된다 — 그 사람은 보드에서 진짜로 실행할 수 있다. */}
            {!setup.ready && (
              <button
                type="button"
                data-testid="onramp-decompose-run"
                onClick={requestRun}
                className="inline-flex h-7 items-center rounded-md border border-[#45475a] px-2.5 text-xs font-medium text-[#cdd6f4] transition-colors hover:bg-[#313244]"
              >
                {t("onramp.decompose.runCta")}
              </button>
            )}
            {onOpenBoard && (
              <button
                type="button"
                data-testid="onramp-decompose-open-board"
                onClick={onOpenBoard}
                className="text-[11px] text-[#89b4fa] underline decoration-dotted transition-colors hover:text-[#74c7ec]"
              >
                {t("onramp.decompose.openBoard", { count: demoTicketCount })}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
