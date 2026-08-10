import { Suspense } from "react";
import LinkClient from "./LinkClient";

// 앱 최초 실행이 여는 설치 환영 페이지(`/<locale>/link?i=<익명 설치 ID>`).
// 색인 대상이 아니다 — 쿼리로 설치 ID 를 받는 일회성 진입점이다.
export const metadata = {
  robots: { index: false, follow: false },
};

export default function InstallLinkPage() {
  return (
    <Suspense fallback={null}>
      <LinkClient />
    </Suspense>
  );
}
