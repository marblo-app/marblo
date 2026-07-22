import type { Metadata } from "next";

// The checkout page (and its success/fail children) is a Client Component and
// cannot export metadata, so this server-only layout supplies it.
//
// noindex: checkout is a transactional flow that only makes sense mid-purchase
// (it reads query params and gates on auth). Letting search engines index it
// produces thin / soft-404 "Crawled - currently not indexed" noise in Search
// Console. It is deliberately kept crawlable (not robots.txt-disallowed) so the
// noindex directive is actually seen and any stale index entries drop cleanly.
export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
