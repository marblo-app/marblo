import type { Metadata } from "next";

// noindex + nofollow: the admin console is staff-only. Unlike /my and /auth
// there is no public value in following its links either, so both directives
// are off.
//
// See src/app/[locale]/my/layout.tsx for why the matching robots.txt Disallow
// had to be dropped for this directive to take effect.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
