import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { featuredPostsFor } from "@/data/featuredPosts";
import { localeHref } from "@/i18n/routing";

/**
 * 홈에서 추천 글로 나가는 링크.
 *
 * 홈은 사이트에서 내부 링크를 가장 많이 받는 페이지이고(헤더·푸터·모든 글의
 * 브레드크럼이 홈을 가리킨다), 실측상 이미 색인돼 있다. 그런데 2026-08-21
 * 기준 홈에서 블로그로 나가는 링크가 **0개**였다. 크롤러가 홈까지 와서
 * 블로그 글로 이어갈 길이 없었다는 뜻이다.
 *
 * 제목·설명은 하드코딩하지 않고 MDX frontmatter 에서 읽는다. 글 제목을 고치면
 * 여기가 자동으로 따라간다(푸터는 서버 전용 로더를 못 써서 짧은 라벨을 쓴다).
 *
 * 서버 컴포넌트다. `@/lib/blog` 은 `server-only` 이므로 클라이언트에서 import
 * 되면 빌드가 깨진다 — 그게 의도된 가드다.
 */
export default function FeaturedPostsSection({ locale }: { locale: string }) {
  const featured = featuredPostsFor(locale);
  if (featured.length === 0) return null;

  const bySlug = new Map(getAllPosts(locale).map((p) => [p.slug, p]));
  const posts = featured
    .map((f) => bySlug.get(f.slug))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (posts.length === 0) return null;

  const heading =
    locale === "ko"
      ? "에이전트를 여러 대 굴리는 법"
      : locale === "ja"
      ? "エージェントを複数動かす方法"
      : "How to run many agents at once";
  const subheading =
    locale === "ko"
      ? "병렬 실행·충돌 방지·오케스트레이션에 대한 실전 노트."
      : locale === "ja"
      ? "並列実行・衝突回避・オーケストレーションの実践ノート。"
      : "Practical notes on parallel execution, collision-free worktrees, and orchestration.";
  const allPosts =
    locale === "ko"
      ? "전체 글 보기"
      : locale === "ja"
      ? "記事一覧を見る"
      : "Read all posts";

  return (
    <section className="py-24 px-4 border-t border-zinc-800/50">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold">{heading}</h2>
            <p className="mt-3 text-zinc-400">{subheading}</p>
          </div>
          <Link
            href={localeHref(locale, "/blog")}
            className="text-indigo-400 hover:text-indigo-300 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
          >
            {allPosts} →
          </Link>
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={localeHref(locale, `/blog/${post.slug}`)}
                className="block h-full rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <h3 className="text-lg font-semibold text-white">
                  {post.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-400 line-clamp-2">
                  {post.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
