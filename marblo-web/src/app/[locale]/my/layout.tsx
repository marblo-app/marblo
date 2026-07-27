import type { Metadata } from "next";

// noindex: /my/* is the signed-in account area (subscription, lectures,
// privacy settings). It renders nothing useful to a logged-out crawler, and
// every locale variant is a near-duplicate shell — exactly the shape that
// shows up in Search Console as "Duplicate without user-selected canonical" /
// "Crawled - currently not indexed".
//
// `follow: true` on purpose: the shell still links back to real marketing
// pages, and there is no reason to strand that link equity.
//
// This tag only works if Googlebot is allowed to FETCH the page — see
// src/app/robots.ts, where the matching Disallow rules were removed. A URL
// blocked in robots.txt can never be de-indexed, because the crawler never
// gets to read this directive.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
