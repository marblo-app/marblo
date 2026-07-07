import type { Metadata } from "next";

// Client page → per-route title lives in this server-only layout.
// Renders as "Refund Policy | Marblo" via the parent title.template.
export const metadata: Metadata = {
  title: "Refund Policy",
};

export default function RefundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
