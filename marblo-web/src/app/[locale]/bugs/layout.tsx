import type { Metadata } from "next";

// The bug-report page is a Client Component and cannot export metadata, so this
// server-only layout supplies it.
//
// noindex: this is an authenticated support form (it calls a Firebase callable
// and requires sign-in), not search content. Kept crawlable (not disallowed) so
// the directive is honored and it stays out of Search Console's index reports.
export const metadata: Metadata = {
  title: "Report a Bug",
  robots: { index: false, follow: false },
};

export default function BugsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
