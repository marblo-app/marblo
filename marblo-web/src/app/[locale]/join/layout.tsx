import type { Metadata } from "next";

// noindex: /join/<token> 은 1회용 초대 토큰 착지다. 색인되면 토큰 URL 이
// 검색엔진에 남는 것 자체가 사고이고(공유·만료 뒤에도 잔존), 콘텐츠도 없다.
// auth/checkout 레이아웃과 같은 규약 — 크롤 가능하게 두어 지시가 실제로
// 읽히게 한다(robots.txt Disallow 를 쓰지 않는 이유도 그 레이아웃들과 같다).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function JoinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
