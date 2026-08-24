import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FEATURED_POSTS,
  FEATURED_SLUGS,
  featuredPostsFor,
  featuredLabel,
} from "./featuredPosts";

const BLOG_ROOT = path.join(process.cwd(), "content", "blog");
const LOCALES = ["ko", "en", "ja"] as const;

function postFile(locale: string, slug: string): string | null {
  return (
    [".mdx", ".md"]
      .map((ext) => path.join(BLOG_ROOT, locale, `${slug}${ext}`))
      .find((p) => fs.existsSync(p)) ?? null
  );
}

// 추천 글은 Footer 를 통해 **모든 페이지**에서 링크된다. 존재하지 않는
// (locale, slug) 조합이 들어가면 사이트 전역에 404 링크가 깔린다. 크롤러가 죽은
// 링크를 밟는 건 지금 고치려는 문제(크롤 예산)를 정확히 반대로 악화시킨다.
test("추천 글은 선언한 모든 로케일에 실제 파일이 있다", () => {
  for (const post of FEATURED_POSTS) {
    assert.ok(post.locales.length > 0, `${post.slug}: locales 가 비었다`);
    for (const locale of post.locales) {
      assert.ok(
        postFile(locale, post.slug),
        `content/blog/${locale}/${post.slug}.mdx 가 없다 — Footer 가 404 를 링크하게 된다`
      );
    }
  }
});

// frontmatter 의 `locales` 가 진실의 원천이다. 여기가 어긋나면 hreflang 과
// 푸터 링크가 서로 다른 얘기를 하게 된다.
test("추천 글의 locales 가 frontmatter 의 locales 와 어긋나지 않는다", () => {
  for (const post of FEATURED_POSTS) {
    for (const locale of post.locales) {
      const file = postFile(locale, post.slug);
      assert.ok(file);
      const raw = fs.readFileSync(file, "utf8");
      const declared = raw.match(/^locales:\s*\[(.*)\]\s*$/m)?.[1] ?? "";
      assert.ok(
        declared.includes(`"${locale}"`),
        `${post.slug} (${locale}): frontmatter locales 에 ${locale} 이 없다`
      );
    }
  }
});

test("추천 글 슬러그는 중복되지 않는다", () => {
  assert.equal(FEATURED_SLUGS.size, FEATURED_POSTS.length);
});

// ★집중이 이 목록의 존재 이유다. 늘리기 시작하면 다시 33편 균등 배분이 된다.
// 늘려야 할 근거가 생겼다면 featuredPosts.ts 주석의 선정 근거를 먼저 갱신하고
// 이 숫자를 의식적으로 올릴 것.
test("추천 글은 5편을 넘지 않는다 (집중이 목적이다)", () => {
  assert.ok(
    FEATURED_POSTS.length <= 5,
    `추천 글 ${FEATURED_POSTS.length}편 — 집중이 아니라 배분이 되고 있다`
  );
});

test("모든 로케일에 라벨이 있고, 지원 로케일마다 최소 1편은 남는다", () => {
  for (const post of FEATURED_POSTS) {
    for (const locale of LOCALES) {
      assert.ok(
        featuredLabel(post, locale).trim().length > 0,
        `${post.slug}: ${locale} 라벨이 비었다`
      );
    }
  }
  for (const locale of LOCALES) {
    assert.ok(
      featuredPostsFor(locale).length > 0,
      `${locale}: 추천 글이 하나도 없어 푸터 블로그 열이 빈다`
    );
  }
});
