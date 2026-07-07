import type { Metadata } from "next";

// Client page → per-route title lives in this server-only layout.
// Renders as "Beta Survey | Marblo" via the parent title.template.
export const metadata: Metadata = {
  title: "Beta Survey",
};

export default function BetaSurveyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
