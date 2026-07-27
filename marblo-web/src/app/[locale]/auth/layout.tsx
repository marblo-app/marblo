import type { Metadata } from "next";

// noindex: /auth/login and /auth/signup are transactional entry points, not
// content. Indexed sign-in pages compete with the real landing pages for
// brand queries ("마블로 로그인" outranking "마블로") and add nothing for a
// searcher who has not installed the app yet.
//
// See src/app/[locale]/my/layout.tsx for why the matching robots.txt Disallow
// had to be dropped for this directive to take effect.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
