import type { Metadata } from "next";

// Client page → per-route title lives in this server-only layout.
// Renders as "Founder Program | Marblo" via the parent title.template.
export const metadata: Metadata = {
  title: "Founder Program",
};

export default function FoundersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
