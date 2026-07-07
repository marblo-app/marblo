import type { Metadata } from "next";
import { lectures } from "@/data/lectures";

// Client page → per-lecture title lives in this server-only layout.
// Looks the slug up in the static lecture catalog; unknown slugs (e.g. ones
// served only from Firestore) fall back to the generic "Lectures" title.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lecture = lectures.find((l) => l.slug === slug);
  // A specific lecture's marketing title is self-contained (it already names
  // Marblo), so use `absolute` to render it on its own. The intermediate
  // lectures/ layout sets a plain-string title, which resets the parent
  // "%s | Marblo" template for this grandchild anyway — `absolute` makes that
  // intent explicit instead of accidental, and keeps the fallback branded.
  return {
    title: { absolute: lecture ? lecture.title_en : "Lectures | Marblo" },
  };
}

export default function LectureDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
