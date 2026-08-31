import type { Metadata } from "next";

// noindex: /org/* 는 로그인한 조직 구성원만 의미가 있는 화면이고, 로케일 변형이
// 전부 같은 껍데기다(`/team`·`/my` 와 같은 이유 — src/app/[locale]/team/layout.tsx).
// sitemap.ts 에도 넣지 않는다. robots.txt Disallow 는 하지 않는다 — 로그인
// 게이트가 200 이 아니므로 크롤 자체가 무의미하다(#1333 §3.2).
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return children;
}
