import type { Metadata } from "next";

// noindex: 결제 직후에만 의미가 있는 트랜잭션 화면(auth/checkout 레이아웃과
// 같은 규약). /org 상위 레이아웃은 조직 뼈대 ②(krDTLfTP) 소유라 여기(new/)에만
// 건다 — 이 디렉터리가 이 티켓이 소유하는 유일한 /org 하위 경로다.
export const metadata: Metadata = {
  title: "New organization",
  robots: { index: false, follow: false },
};

export default function OrgNewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
