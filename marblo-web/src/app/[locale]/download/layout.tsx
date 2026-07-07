import type { Metadata } from "next";

// The page itself is a Client Component and cannot export metadata, so this
// server-only layout supplies the per-route title. The parent [locale] layout's
// title.template ("%s | Marblo") wraps it → "Download | Marblo".
export const metadata: Metadata = {
  title: "Download",
};

export default function DownloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
