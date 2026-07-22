import type { Metadata } from "next";

// Client page → per-route title lives in this server-only layout.
// Renders as "Beta Survey | Marblo" via the parent title.template.
// noindex: this is a private feedback form (reached only by invited founders),
// not search content. Overriding the parent layout's index:true keeps it — and
// the /founders/feedback redirect that lands here — out of the index.
export const metadata: Metadata = {
  title: "Beta Survey",
  robots: { index: false, follow: true },
};

export default function BetaSurveyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
