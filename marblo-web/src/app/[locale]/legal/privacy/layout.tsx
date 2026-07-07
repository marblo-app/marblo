import type { Metadata } from "next";

// Client page → per-route title lives in this server-only layout.
// Renders as "Privacy Policy | Marblo" via the parent title.template.
export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
