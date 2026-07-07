import type { Metadata } from "next";

// Client page → per-route title lives in this server-only layout.
// Renders as "Lectures | Marblo" via the parent title.template.
export const metadata: Metadata = {
  title: "Lectures",
};

export default function LecturesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
