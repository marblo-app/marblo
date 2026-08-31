/**
 * (h) 가이드 진입점 3개 — #1338 §6. ★새 가이드 페이지를 만들지 않는다.
 *
 * 기존 `guide/` 1페이지(8단계 27소단계)가 활성화 경로 전체를 이미 덮고 있고,
 * 부족한 것은 내용이 아니라 "지금 나에게 필요한 것"으로 들어가는 **문**이다.
 * 그래서 이 컴포넌트는 문 3개다 — 전부 기존 앵커로의 딥링크이고, 앵커 유효성은
 * `GuideEntryPoints.test.tsx` 가 `GUIDE_ANCHOR_IDS` 로 고정한다.
 *
 * 진입점 선정은 실측 이탈에서 역산했다(#1338 §1.3): 베타 이탈 1순위가 "설치는
 * 했는데 에이전트 인증에서 막힘"이라 첫 문이 #auth(받기 전 준비)다.
 */
import { BookOpen, KeyRound, Rocket, Users } from "lucide-react";
import type { GuideSectionId } from "@/lib/guideContent";
import {
  formatCopy,
  type OrgOnboardingCopy,
  type OrgOnboardingCopyKey,
} from "@/lib/orgOnboardingCopy";

export interface GuideEntryPoint {
  id: "prepare" | "firstAgent" | "teamwork";
  /** 기존 guide/ 섹션 앵커 — 신규 페이지가 아니라 딥링크다. */
  anchor: GuideSectionId;
  titleKey: OrgOnboardingCopyKey;
  bodyKey: OrgOnboardingCopyKey;
}

/** 진입점 정의 — 테스트가 앵커 유효성·개수(정확히 3)를 이 배열로 검사한다. */
export const GUIDE_ENTRY_POINTS: readonly GuideEntryPoint[] = [
  {
    // G1: 받기 전 준비 — 에이전트 CLI 계정. 이탈 1순위를 설치 전으로 당긴다.
    id: "prepare",
    anchor: "auth",
    titleKey: "guideEntry.prepare.title",
    bodyKey: "guideEntry.prepare.body",
  },
  {
    // G2: 설치 → 첫 에이전트 — 퍼널 17→7 구간(켜봄→완료) 담당.
    id: "firstAgent",
    anchor: "install",
    titleKey: "guideEntry.firstAgent.title",
    bodyKey: "guideEntry.firstAgent.body",
  },
  {
    // G3: 팀에서 일하기 — 공유 보드·워크스페이스.
    id: "teamwork",
    anchor: "workspace",
    titleKey: "guideEntry.teamwork.title",
    bodyKey: "guideEntry.teamwork.body",
  },
];

const ENTRY_ICONS = {
  prepare: KeyRound,
  firstAgent: Rocket,
  teamwork: Users,
} as const;

/**
 * 진입점 카드 3장. `guideHrefBase` 는 로케일이 반영된 `/guide` 경로
 * (`localeHref(locale, "/guide")`) — 여기에 앵커만 붙인다.
 */
export default function GuideEntryPoints({
  copy,
  guideHrefBase,
}: {
  copy: OrgOnboardingCopy;
  guideHrefBase: string;
}) {
  return (
    <section aria-label={copy["guideEntry.title"]} className="text-left">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <BookOpen className="w-5 h-5 text-indigo-300" />
        {copy["guideEntry.title"]}
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        {copy["guideEntry.subtitle"]}
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {GUIDE_ENTRY_POINTS.map((entry) => {
          const Icon = ENTRY_ICONS[entry.id];
          return (
            <a
              key={entry.id}
              href={`${guideHrefBase}#${entry.anchor}`}
              className="group flex flex-col gap-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-indigo-500/60 hover:bg-zinc-900 transition"
            >
              <Icon className="w-5 h-5 text-indigo-300" />
              <span className="text-sm font-semibold text-zinc-100">
                {formatCopy(copy[entry.titleKey], {})}
              </span>
              <span className="text-xs text-zinc-400 leading-relaxed">
                {formatCopy(copy[entry.bodyKey], {})}
              </span>
              <span className="mt-auto text-xs font-medium text-indigo-400 group-hover:text-indigo-300">
                {copy["guideEntry.open"]} →
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
