/**
 * 내부 링크 그래프 회귀 테스트.
 *
 * 이 티켓의 원인 진단은 "블로그 글마다 내부 인바운드 링크가 1개뿐" 이었다
 * (2026-08-21 실측: 블로그 인덱스에서 오는 링크 하나가 전부). 구글은 링크를
 * 따라다니고, 인바운드 1개는 "안 중요한 페이지" 신호다. Search Console 이
 * /en/blog/* 를 "발견됨 – 최종 크롤링: 해당사항 없음" 으로 보고한 이유다.
 *
 * 그 상태로 되돌아가는 걸 막는 게 이 파일의 목적이다. UI 스냅샷이 아니라
 * **링크 개수**를 검사한다.
 *
 * `@/lib/blog` 은 `server-only` 라 여기서 못 부른다. 그래서 실제 MDX
 * frontmatter 를 직접 읽어 `getAllPosts` 와 동일한 계약(최신순 정렬)을 만든 뒤,
 * 선정 규칙의 순수 함수(`selectRelatedPosts`)에 그대로 물린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { selectRelatedPosts } from "@/lib/relatedPosts";
import { FEATURED_POSTS, featuredPostsFor } from "@/data/featuredPosts";

const BLOG_ROOT = path.join(process.cwd(), "content", "blog");
const LOCALES = ["ko", "en", "ja"] as const;
const RELATED_LIMIT = 3;

type Post = { slug: string; category: string; date: string };

function field(raw: string, name: string): string | null {
  return raw.match(new RegExp(`^${name}:\\s*"([^"]*)"\\s*$`, "m"))?.[1] ?? null;
}

/** `getAllPosts(locale)` 와 같은 계약: 그 로케일에 게시된 글, 최신순. */
function loadPosts(locale: string): Post[] {
  const dir = path.join(BLOG_ROOT, locale);
  if (!fs.existsSync(dir)) return [];
  const posts: Post[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!/\.mdx?$/.test(file)) continue;
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const category = field(raw, "category");
    const date = field(raw, "date");
    const declared = raw.match(/^locales:\s*\[(.*)\]\s*$/m)?.[1] ?? "";
    if (!category || !date || !declared.includes(`"${locale}"`)) continue;
    posts.push({ slug: file.replace(/\.mdx?$/, ""), category, date });
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** locale 안에서 글 → 그 글을 관련 글로 지목한 다른 글들의 수. */
function inboundFromRelated(posts: Post[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const post of posts) counts.set(post.slug, 0);
  for (const post of posts) {
    for (const rel of selectRelatedPosts(posts, post.slug, RELATED_LIMIT)) {
      counts.set(rel.slug, (counts.get(rel.slug) ?? 0) + 1);
    }
  }
  return counts;
}

test("테스트가 읽는 글 수가 사이트맵과 맞는다 (로더가 조용히 비면 뒤 검사가 무의미해진다)", () => {
  const counts = LOCALES.map((l) => loadPosts(l).length);
  assert.deepEqual(counts, [14, 13, 6], `ko/en/ja = ${counts.join("/")}`);
});

test("관련 글은 자기 자신을 포함하지 않고, 한도를 넘지 않고, 실제로 존재한다", () => {
  for (const locale of LOCALES) {
    const posts = loadPosts(locale);
    const known = new Set(posts.map((p) => p.slug));
    for (const post of posts) {
      const related = selectRelatedPosts(posts, post.slug, RELATED_LIMIT);
      assert.ok(
        related.length <= RELATED_LIMIT,
        `${locale}/${post.slug}: 관련 글이 ${related.length}편`
      );
      const slugs = related.map((r) => r.slug);
      assert.ok(
        !slugs.includes(post.slug),
        `${locale}/${post.slug}: 자기 자신을 관련 글로 링크했다`
      );
      assert.equal(
        new Set(slugs).size,
        slugs.length,
        `${locale}/${post.slug}: 관련 글이 중복됐다`
      );
      for (const s of slugs) {
        assert.ok(known.has(s), `${locale}/${post.slug} → ${s}: 없는 글이다`);
      }
    }
  }
});

test("관련 글 선정은 결정론적이다 (렌더마다 링크 그래프가 흔들리면 안 된다)", () => {
  for (const locale of LOCALES) {
    const posts = loadPosts(locale);
    for (const post of posts) {
      const a = selectRelatedPosts(posts, post.slug, RELATED_LIMIT).map(
        (p) => p.slug
      );
      const b = selectRelatedPosts(posts, post.slug, RELATED_LIMIT).map(
        (p) => p.slug
      );
      assert.deepEqual(
        a,
        b,
        `${locale}/${post.slug}: 두 번 호출 결과가 다르다`
      );
    }
  }
});

// 핵심 회귀 가드. "인바운드 1개" 로 돌아가면 여기서 깨진다.
test("모든 글이 블로그 인덱스 말고도 인바운드 링크를 최소 1개 더 받는다", () => {
  for (const locale of LOCALES) {
    const posts = loadPosts(locale);
    if (posts.length < 2) continue; // 글이 1편이면 서로 링크할 상대가 없다
    for (const [slug, n] of inboundFromRelated(posts)) {
      assert.ok(
        n >= 1,
        `${locale}/${slug}: 관련 글 인바운드가 0 — 블로그 인덱스 링크 1개뿐인 상태로 돌아갔다`
      );
    }
  }
});

// 집중 확인: 추천 글은 평균보다 확실히 많이 받아야 한다. 균등하게 퍼지면
// 이 티켓이 하려던 일(예산을 몰아주기)이 무효가 된다.
test("추천 글이 평범한 글보다 더 많은 인바운드를 받는다", () => {
  for (const locale of LOCALES) {
    const featured = featuredPostsFor(locale).map((p) => p.slug);
    if (featured.length === 0) continue;
    const counts = inboundFromRelated(loadPosts(locale));
    const others = [...counts.entries()]
      .filter(([slug]) => !featured.includes(slug))
      .map(([, n]) => n);
    if (others.length === 0) continue;
    const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
    for (const slug of featured) {
      const n = counts.get(slug) ?? 0;
      assert.ok(
        n > avgOthers,
        `${locale}/${slug}: 인바운드 ${n} <= 비추천 평균 ${avgOthers.toFixed(
          2
        )} — 링크가 집중되지 않았다`
      );
    }
  }
});

// 푸터·홈은 코드에서 링크가 나가는지 소스로 확인한다(렌더 없이). 이 두 곳이
// 사이트 전역/최상위 권위 페이지라 링크 구조에서 가장 크게 작용한다.
test("푸터와 홈에서 블로그로 나가는 링크가 존재한다", () => {
  const footer = fs.readFileSync(
    path.join(process.cwd(), "src/components/Footer.tsx"),
    "utf8"
  );
  assert.match(
    footer,
    /featuredPostsFor/,
    "Footer 에서 추천 글 링크가 사라졌다 — 사이트 전역 인바운드가 0으로 돌아간다"
  );
  // as-needed 라우팅에서는 `/${locale}/blog` 같은 하드코딩 템플릿이 리터럴로
  // 남아 있으면 그 자체가 버그다(기본 로케일에서 301을 만든다) — 그래서
  // localeHref 를 거치는지 확인한다.
  assert.match(
    footer,
    /localeHref\(locale, ["'`]\/blog["'`]\)/,
    "Footer 에 블로그 인덱스 링크가 없다"
  );

  const home = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/page.tsx"),
    "utf8"
  );
  assert.match(
    home,
    /FeaturedPostsSection/,
    "홈에서 블로그로 나가는 링크가 사라졌다"
  );

  const detail = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/blog/[slug]/page.tsx"),
    "utf8"
  );
  assert.match(
    detail,
    /getRelatedPosts/,
    "글 상세에서 관련 글이 사라졌다 — 글 상세가 다시 막다른 골목이 된다"
  );
});

test("추천 글은 어느 로케일에서도 그 로케일 글 목록 안에 있다", () => {
  for (const locale of LOCALES) {
    const known = new Set(loadPosts(locale).map((p) => p.slug));
    for (const post of FEATURED_POSTS) {
      if (!post.locales.includes(locale)) continue;
      assert.ok(
        known.has(post.slug),
        `${locale}: 추천 글 ${post.slug} 이(가) 목록에 없다 — 죽은 링크가 된다`
      );
    }
  }
});
