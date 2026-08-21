/**
 * 공개 Mission Replay 페이지 (Phase 4-2).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §4 Phase 4 · §7.2(웹) · §5.7 F5.
 *
 * 이 파일이 하는 일은 셋뿐이다: **읽고(1건 get) · 없으면 404 · 메타를 채운다.**
 * 렌더는 `components/PublicReplayArticle`(순수), 신뢰 경계는 `lib/publicReplay`
 * 한 곳이다.
 *
 * ★`dangerouslySetInnerHTML` 은 이 라우트에 한 글자도 없다 — replay 데이터로
 * 만드는 JSON-LD 도 넣지 않는다. 이 레포의 다른 페이지(layout·FAQ·블로그)는
 * JSON-LD 를 `dangerouslySetInnerHTML` 로 주입하는데, 그 관행을 여기로 가져오면
 * 사용자가 쓴 `goal` 안의 `</script>` 한 조각이 곧바로 스크립트 주입이 된다
 * (§5.7 F5). 공개 Replay 는 **남이 쓴 문자열을 우리 도메인에서 그리는** 유일한
 * 라우트다. 구조화 데이터의 SEO 이득보다 이 경계가 우선한다. 불변식은 문서가
 * 아니라 테스트로 지킨다(`lib/publicReplay.test.ts`).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { localeUrl } from "@/lib/seo";
import { fetchPublicReplay } from "@/lib/publicReplay";
import PublicReplayArticle, {
  type ReplayLabels,
} from "@/components/PublicReplayArticle";
import { localeHref } from "@/i18n/routing";

/**
 * ISR. 해제(unpublish)가 404 로 반영되기까지의 우리 층 최대 지연이다. 설계 §7.1
 * 은 "해제해도 CDN·소셜 캐시·검색 인덱스는 남는다"를 전제로 두지만, 우리가
 * 통제하는 캐시는 짧게 잡는다.
 */
export const revalidate = 60;

type PageParams = { locale: string; replayId: string };

/**
 * 기본 OG 이미지.
 *
 * ★설계 §7.2 는 "OG 이미지는 앱에서 만들어 올린 PNG 를 쓴다(서버 렌더 금지)"
 * 인데, 지금 그 PNG 를 가리킬 칸이 없다: `publicReplays` 문서의 필드는 룰에서
 * [schemaVersion, replayVersion, level, status, payload, publishedAt] 로 **hasOnly**
 * 고정이고, P3 공유카드는 다운로드 전용(업로드 경로 없음)이다. 그래서 지금은
 * 사이트 기본 이미지를 쓰고, `lib/publicReplay.parseCardImageUrl` 이 payload 안
 * optional `card.imageUrl` 을 미리 받아 둔다 — 후속 티켓이 업로드를 붙이면 웹
 * 수정 없이 미션별 카드로 전환된다.
 */
const FALLBACK_OG_IMAGE = "/images/product-demo.png";

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, replayId } = await params;
  const t = await getTranslations({ locale, namespace: "replay" });
  const replay = await fetchPublicReplay(replayId);

  // 없는/해제된 Replay 에는 미리보기를 만들지 않는다.
  if (!replay) {
    return {
      title: t("notFoundTitle"),
      robots: { index: false, follow: false },
    };
  }

  // goal 은 사용자가 쓴 문자열이다. Next 가 메타 속성을 이스케이프하고, 그 전에
  // 이미 제어·양방향 문자를 걷어내고 길이를 잘라 두었다(lib/publicReplay).
  const title = replay.goal || t("untitled");
  const description = t("ogDescription", {
    tasks: replay.stats.tasksDone ?? replay.stats.tasks ?? 0,
    agents: replay.stats.agents ?? replay.cast.length,
  });
  const url = localeUrl(locale, `/replay/${replayId}`);
  const image = replay.cardImageUrl ?? FALLBACK_OG_IMAGE;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "article",
      siteName: "Marblo",
      images: [{ url: image }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
    // ★색인하지 않는다. 설계 §7.1 은 "해제해도 검색 인덱스는 남는다"를 F6 의
    //   잔존 위험으로 든다 — 우리가 줄일 수 있는 잔존면은 줄인다. 공유 미리보기
    //   (OG/트위터 카드)는 noindex 와 무관하게 동작하므로 바이럴 경로는 그대로다.
    robots: { index: false, follow: false },
  };
}

export default async function PublicReplayPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, replayId } = await params;
  const t = await getTranslations({ locale, namespace: "replay" });
  const replay = await fetchPublicReplay(replayId);

  // 없음 · 비발행 · 해제됨 · 스키마 불일치 = 전부 같은 404. "존재하지만 비공개"를
  // 구분해 주지 않는 것이 F6 의 요구다(취소본의 존재조차 알려주지 않는다).
  if (!replay) notFound();

  const labels: ReplayLabels = {
    level: t(`level.${replay.level}`),
    redactedBadge: t("redactedBadge"),
    untitled: t("untitled"),
    duration: (duration) => t("duration", { duration }),
    completedAt: (at) => t("completedAt", { at }),
    castTitle: t("castTitle"),
    unknownAgent: t("unknownAgent"),
    tasksCompleted: (count) => t("tasksCompleted", { count }),
    timelineTitle: t("timelineTitle"),
    beatsOmitted: (count) => t("beatsOmitted", { count }),
    prTitle: t("prTitle"),
    creditedTo: t("creditedTo"),
    privacyNote: t("privacyNote"),
    cta: t("cta"),
    stats: {
      tasksDone: t("stats.tasksDone"),
      agents: t("stats.agents"),
      prs: t("stats.prs"),
      filesChanged: t("stats.filesChanged"),
      lines: t("stats.lines"),
      testsPassed: t("stats.testsPassed"),
      riskFlags: t("stats.riskFlags"),
      retries: t("stats.retries"),
      costTotal: t("stats.costTotal"),
    },
  };

  return (
    <PublicReplayArticle
      replay={replay}
      labels={labels}
      homeHref={localeHref(locale)}
    />
  );
}
