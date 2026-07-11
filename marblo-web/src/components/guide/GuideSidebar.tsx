"use client";

import { useEffect, useState } from "react";
import { List, X } from "lucide-react";

/**
 * Ordered tree navigation for the guide (developer-docs style).
 *
 * All labels arrive pre-translated as props from the server page so this stays
 * a thin interaction layer (no i18n reads here). Responsibilities:
 *  - render the ordered section → sub-step tree with anchor deep-links
 *  - scroll-spy the current section/sub-step via IntersectionObserver
 *  - auto-expand the active section
 *  - collapse into a top drawer on mobile (< lg), sticky rail on desktop
 */

export interface GuideSidebarSubstep {
  id: string;
  title: string;
}

export interface GuideSidebarSection {
  id: string;
  num: number;
  title: string;
  substeps: GuideSidebarSubstep[];
}

interface GuideSidebarProps {
  sections: GuideSidebarSection[];
  /** Flat anchor id list in document order (sections interleaved with subs). */
  anchorIds: string[];
  tocTitle: string;
}

export default function GuideSidebar({
  sections,
  anchorIds,
  tocTitle,
}: GuideSidebarProps) {
  const [activeId, setActiveId] = useState<string>(anchorIds[0] ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Scroll-spy: track which anchors are within the "reading zone" (just below
  // the sticky header, upper ~45% of the viewport) and mark the topmost one
  // active. Keeping a live Set avoids the flicker of naive last-fired logic.
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const topmost = anchorIds.find((id) => visible.has(id));
        if (topmost) setActiveId(topmost);
      },
      // Header is ~64px; -55% bottom margin means an anchor is "active" only
      // while its heading sits in the top 45% of the viewport.
      { rootMargin: "-80px 0px -55% 0px", threshold: 0 }
    );

    const nodes = anchorIds
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null);
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [anchorIds]);

  // Which section is currently active (either the section itself or one of its
  // sub-steps is the active anchor). Drives highlight + auto-expand.
  const activeSectionId =
    sections.find(
      (s) => s.id === activeId || s.substeps.some((sub) => sub.id === activeId)
    )?.id ?? sections[0]?.id;

  const handleNavigate = () => setDrawerOpen(false);

  const tree = (
    <nav aria-label={tocTitle}>
      <p className="px-3 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {tocTitle}
      </p>
      <ol className="space-y-0.5">
        {sections.map((section) => {
          const isActiveSection = section.id === activeSectionId;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                onClick={handleNavigate}
                aria-current={activeId === section.id ? "true" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActiveSection
                    ? "bg-brand-500/10 text-brand-200"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                    isActiveSection
                      ? "bg-brand-500 text-white"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {section.num}
                </span>
                <span className="truncate">{section.title}</span>
              </a>

              {/* Sub-steps: only mounted for the active section to keep the
                  tree compact (accordion-style ordered tree). */}
              {isActiveSection && section.substeps.length > 0 && (
                <ul className="mt-0.5 mb-1 ml-[1.6rem] border-l border-zinc-800 pl-3 space-y-0.5">
                  {section.substeps.map((sub) => (
                    <li key={sub.id}>
                      <a
                        href={`#${sub.id}`}
                        onClick={handleNavigate}
                        aria-current={activeId === sub.id ? "true" : undefined}
                        className={`block rounded-md px-2.5 py-1.5 text-[13px] transition ${
                          activeId === sub.id
                            ? "text-brand-300 font-medium"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {sub.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );

  return (
    <>
      {/* Mobile: collapsible drawer trigger (< lg) */}
      <div className="lg:hidden sticky top-16 z-30 -mx-4 mb-6 border-b border-zinc-800/60 bg-zinc-950/90 px-4 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-expanded={drawerOpen}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-sm font-medium text-zinc-200"
        >
          <span className="flex items-center gap-2">
            {drawerOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <List className="h-4 w-4" />
            )}
            {tocTitle}
          </span>
        </button>
        {drawerOpen && (
          <div className="mt-3 max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/50 p-2">
            {tree}
          </div>
        )}
      </div>

      {/* Desktop: sticky rail (lg+) */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
          {tree}
        </div>
      </aside>
    </>
  );
}
