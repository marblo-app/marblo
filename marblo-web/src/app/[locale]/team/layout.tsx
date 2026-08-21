import type { Metadata } from "next";

// noindex: /team/* 은 로그인한 오너·멤버만 의미가 있는 화면이고, 로케일 변형이
// 전부 같은 껍데기다. `/my/*` 와 같은 이유로 색인에서 뺀다(src/app/[locale]/my/layout.tsx
// 주석 참조 — robots.txt Disallow 가 있으면 이 디렉티브가 읽히지도 않는다).
//
// `follow: true`: 이 껍데기도 마케팅 페이지로 돌아가는 링크를 갖는다.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children;
}
