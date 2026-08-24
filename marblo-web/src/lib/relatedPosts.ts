import { FEATURED_POSTS } from "@/data/featuredPosts";

/**
 * 관련 글 선정 규칙 — 순수 함수.
 *
 * `@/lib/blog` 은 `server-only` + fs 라 단위 테스트에서 부를 수 없다. 규칙 자체는
 * 파일시스템과 무관하므로 여기에 따로 뒀다. 이 티켓에서 검증해야 하는 건
 * "링크가 추천 글로 집중되는가" 라는 **규칙**이지 파일 읽기가 아니다.
 */
export type RelatedCandidate = { slug: string; category: string };

/**
 * `posts` 는 최신순으로 정렬돼 있다고 가정한다(`getAllPosts` 의 계약).
 *
 * 세 칸을 이렇게 나눈다 (limit=3 기준). 전부 결정론적이다 — 렌더마다 달라지면
 * 크롤러가 보는 링크 그래프가 흔들린다.
 *
 *   1칸: 같은 카테고리 최신 글        → 읽는 사람에게 가장 자연스러운 다음 글
 *   1칸: 추천 글 (회전 배정)          → 링크를 집중시키는 칸
 *   1칸: 링(ring) 이웃 posts[(i+1)%n] → **모든 글에 인바운드 1개를 보장**하는 칸
 *
 * 왜 링 칸이 필요한가: 앞의 두 규칙만 쓰면 오래된 글·유일한 카테고리 글은 아무
 * 데서도 링크를 못 받아 인바운드가 다시 1개(블로그 인덱스)로 떨어진다. 글 전체를
 * 한 바퀴 도는 순환을 만들면 n개의 링크로 n개 글 전부가 최소 1개를 받는다.
 * 균등 배분이 아니라 **바닥을 깔아주는 것**이다 — 집중은 추천 글 칸이 한다.
 *
 * 왜 추천 글 칸이 "회전" 인가: 선언 순서대로 앞에서부터 채우면 목록 뒤쪽 추천
 * 글은 영원히 안 뽑힌다(실측으로 확인 — managing-agents-with-tickets 가 0개였다).
 * 현재 글의 위치를 기준으로 회전시키면 추천 글 4편이 고르게 나눠 받는다.
 *
 * 남는 칸은 전체 최신순으로 채운다.
 */
export function selectRelatedPosts<T extends RelatedCandidate>(
  posts: readonly T[],
  slug: string,
  limit = 3
): T[] {
  if (limit <= 0) return [];
  const index = posts.findIndex((p) => p.slug === slug);
  const self = index >= 0 ? posts[index] : undefined;
  const picked: T[] = [];
  const taken = new Set<string>([slug]);

  const take = (post: T | undefined) => {
    if (!post || taken.has(post.slug) || picked.length >= limit) return;
    taken.add(post.slug);
    picked.push(post);
  };

  // 1) 같은 카테고리. 링 칸과 추천 글 칸을 남겨두려고 최대 limit-2 편만 쓴다.
  const sameCategoryQuota = Math.max(0, limit - 2);
  if (self) {
    for (const p of posts) {
      if (picked.length >= sameCategoryQuota) break;
      if (p.category === self.category) take(p);
    }
  }

  // 2) 추천 글 한 편 — 현재 글 위치를 기준으로 회전시켜 고르게 배정한다.
  const featuredCount = FEATURED_POSTS.length;
  const before = picked.length;
  for (let k = 0; k < featuredCount && picked.length === before; k += 1) {
    const rotated =
      FEATURED_POSTS[(Math.max(index, 0) + k) % featuredCount].slug;
    take(posts.find((p) => p.slug === rotated));
  }

  // 3) 링 이웃 — 모든 글이 인바운드를 최소 1개 받게 하는 칸.
  if (index >= 0 && posts.length > 1) {
    take(posts[(index + 1) % posts.length]);
  }

  // 4) 남는 칸은 전체 최신순.
  for (const p of posts) take(p);

  return picked;
}
