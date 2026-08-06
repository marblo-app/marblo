import type { Metadata } from "next";
import { lectures } from "@/data/lectures";
import { buildAlternates } from "@/lib/seo";

// Client page → per-lecture title lives in this server-only layout.
// Looks the slug up in the static lecture catalog; unknown slugs (e.g. ones
// served only from Firestore) fall back to the generic "Lectures" title.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const lecture = lectures.find((l) => l.slug === slug);
  // Korean gets the Korean title. The three locale variants of this URL are
  // hreflang siblings, and they were all serving the identical English string —
  // which both wastes the Korean brand keyword ("마블로") on the page most
  // likely to rank for it and makes the cluster look like unlocalized
  // duplicates. The catalog has no title_ja, so Japanese falls back to English
  // rather than inventing a translation.
  const title = lecture
    ? locale === "ko"
      ? lecture.title_ko
      : lecture.title_en
    : "Lectures | Marblo";
  // A specific lecture's marketing title is self-contained (it already names
  // Marblo), so use `absolute` to render it on its own. The intermediate
  // lectures/ layout sets a plain-string title, which resets the parent
  // "%s | Marblo" template for this grandchild anyway — `absolute` makes that
  // intent explicit instead of accidental, and keeps the fallback branded.
  return {
    title: { absolute: title },
    alternates: buildAlternates(locale, `/lectures/${slug}`),
  };
}

export default function LectureDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
