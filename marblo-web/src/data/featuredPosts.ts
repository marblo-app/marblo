/**
 * 링크를 몰아줄 글 목록.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 왜 "전부" 가 아니라 "몇 편만" 인가
 * ─────────────────────────────────────────────────────────────────────────────
 * Search Console 이 /en/blog/* 를 "발견됨 – 현재 색인이 생성되지 않음 / 최종
 * 크롤링: 해당사항 없음" 으로 보고했다. 한 번도 읽히지 않았다는 뜻이다. 내용
 * 문제가 아니라 **구글이 이 URL 들을 읽으러 올 이유를 못 찾은** 것이다.
 *
 * 실측(2026-08-21): 블로그 글 1편당 내부 인바운드 링크는 정확히 1개(블로그
 * 인덱스). Footer·홈에는 블로그 링크가 아예 없었고, 글끼리도 서로 링크하지
 * 않았다. 인바운드 1개는 "안 중요한 페이지" 신호다.
 *
 * 33편에 링크를 균등 배분하면 33편 모두가 여전히 약하다. 권위가 적을수록
 * 나눠 쓰면 안 된다. 그래서 **4편만** 고르고 거기에 몰아준다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 선정 근거 — docs/SEO-WHY-NO-TRAFFIC-2026-08-21.md §3.3 의 "실제 검색 표현"
 * 표를 기준으로 골랐다. 감(感)이 아니라 그 표다.
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. parallel-agents-that-dont-collide
 *    → "run multiple AI coding agents in parallel" + "claude code parallel"
 *      두 검색군을 동시에 겨냥. 3개 로케일 전부 존재. 검색의도가 가장 뾰족하다.
 * 2. claude-code-subagents
 *    → "claude code parallel / multiple claude code". 고유명사가 들어간 검색어라
 *      신규 도메인도 롱테일에서 붙어볼 여지가 있다. 현재 인바운드 1개.
 * 3. multi-agent-orchestration-marblo
 *    → "AI agent orchestration / orchestrator". 제품 설명과 검색어가 겹치는
 *      유일한 글이라 유입 이후 전환까지 이어진다. 3개 로케일 전부 존재.
 * 4. managing-agents-with-tickets
 *    → "kanban for AI agents". 이 검색군을 겨냥한 글이 이것 하나뿐이다.
 *      현재 인바운드 1개.
 *
 * 일부러 뺀 것과 이유:
 * - what-is-marblo / marblo-beta-open / one-dev-many-agents / getting-started
 *   → 브랜드·제품 검색어. §3.4 에서 "brand 검색은 신규 유입 채널이 될 수 없다"
 *     고 실측됐다(marblo.com 은 1979년 창립 실존 기업). what-is-marblo 는 이미
 *     본문 인바운드가 4개로 가장 많기도 하다.
 * - mcp-getting-started / mcp-advanced-tooling
 *   → MCP 는 Anthropic 공식 문서가 상위를 점유한다. 94일짜리 도메인이 붙을
 *     자리가 아니다. 링크를 몰아줘도 회수가 안 된다.
 * - how-to-use-ai-agents-well / managing-heterogeneous-agents /
 *   worktree-isolation-for-agents
 *   → 글은 좋지만 검색어가 모호하거나(전자), 1번 글과 검색군이 겹친다(후자).
 *     겹치는 걸 같이 밀면 우리끼리 카니벌라이즈된다.
 *
 * ★이 목록은 늘리지 마라. 늘리는 순간 "집중" 이 아니라 "배분" 이 된다.
 *   바꾸려면 위 §3.3 표를 다시 실측하고 근거를 여기에 갱신할 것.
 */

/** Footer 처럼 서버 전용 blog 로더를 못 쓰는 곳에서 쓰는 짧은 링크 라벨. */
export type FeaturedPostLabel = { ko: string; en: string; ja: string };

export type FeaturedPost = {
  slug: string;
  /**
   * 이 슬러그가 실제로 존재하는 로케일. content/blog/<locale>/<slug>.mdx 가
   * 있어야 한다. 없는 조합을 넣으면 깨진 링크가 되므로
   * src/data/featuredPosts.test.ts 가 파일 존재 여부를 실측해서 막는다.
   */
  locales: readonly string[];
  label: FeaturedPostLabel;
};

export const FEATURED_POSTS: readonly FeaturedPost[] = [
  {
    slug: "parallel-agents-that-dont-collide",
    locales: ["ko", "en", "ja"],
    label: {
      ko: "에이전트 6대를 충돌 없이 돌리기",
      en: "Run agents in parallel without collisions",
      ja: "エージェントを衝突なしで並列実行する",
    },
  },
  {
    slug: "claude-code-subagents",
    locales: ["ko", "en"],
    label: {
      ko: "Claude Code 서브에이전트 실전",
      en: "Claude Code subagents in practice",
      ja: "Claude Code サブエージェント実践",
    },
  },
  {
    slug: "multi-agent-orchestration-marblo",
    locales: ["ko", "en", "ja"],
    label: {
      ko: "멀티에이전트 오케스트레이션 구조",
      en: "Multi-agent orchestration, in practice",
      ja: "マルチエージェント・オーケストレーション",
    },
  },
  {
    slug: "managing-agents-with-tickets",
    locales: ["ko", "en"],
    label: {
      ko: "티켓·칸반으로 에이전트 지휘하기",
      en: "Kanban for AI agents",
      ja: "チケットとカンバンでエージェントを指揮する",
    },
  },
] as const;

/** 해당 로케일에 실제로 존재하는 추천 글만. 없는 번역은 절대 링크하지 않는다. */
export function featuredPostsFor(locale: string): FeaturedPost[] {
  return FEATURED_POSTS.filter((p) => p.locales.includes(locale));
}

/** 로케일 라벨 조회. 미지원 로케일은 en 으로 폴백한다. */
export function featuredLabel(post: FeaturedPost, locale: string): string {
  const key = locale as keyof FeaturedPostLabel;
  return post.label[key] ?? post.label.en;
}

/** 추천 글 슬러그 집합 — sitemap 우선순위/관련 글 채우기에서 재사용. */
export const FEATURED_SLUGS: ReadonlySet<string> = new Set(
  FEATURED_POSTS.map((p) => p.slug)
);
