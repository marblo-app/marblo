/**
 * Structure-only definition of the step-by-step onboarding guide.
 *
 * This file owns the SHAPE of the guide — the ordered sections, their anchor
 * ids, the sub-steps under each, the order of content blocks, and any literal
 * shell commands (CLI commands are identical across locales, so they live here
 * rather than in the message catalogs).
 *
 * All human-readable prose (titles, paragraphs, callouts, link labels, image
 * alt text) is referenced by an i18n `key` and resolved from
 * `messages/{ko,en,ja}.json` under the `guide` namespace via `getTranslations`.
 * There is intentionally NO hardcoded UI copy here.
 *
 * Flow reflects the confirmed v3.0.13 onboarding: on first launch Marblo
 * AUTO-installs the required agent CLIs (Claude Code · Codex · Antigravity)
 * and the Marblo MCP — so there is no manual "install from the Harness tab"
 * step. The user's only setup task is authentication. Picking a folder then
 * auto-registers the project (zero clicks) and auto-starts the orchestrator.
 *
 * Order: install & first run → CLI auth → pick folder (auto register +
 * orchestrator auto-start) → first mission → billing → FAQ.
 *
 * Anchors: each top-level section id is a deep-link target
 * (#install, #auth, #project, #mission, #billing, #faq). Each sub-step also
 * gets its own anchor (`${section}-${sub}`) so the left tree can jump to and
 * scroll-spy individual sub-steps.
 */

/** Ordered top-level section anchors. The array order IS the guide order. */
export const GUIDE_SECTION_IDS = [
  "install",
  "auth",
  "project",
  "mission",
  "billing",
  "faq",
] as const;

export type GuideSectionId = typeof GUIDE_SECTION_IDS[number];

/** Callout severity → drives icon + color in the renderer. */
export type CalloutVariant = "note" | "tip" | "warn";

/**
 * A single content block inside a sub-step. `key` values are dot-paths within
 * the `guide` i18n namespace. Code commands and hrefs are structural and live
 * here directly.
 */
export type GuideBlock =
  | { kind: "text"; key: string }
  | { kind: "code"; code: string; captionKey?: string }
  | { kind: "callout"; variant: CalloutVariant; key: string }
  | { kind: "shot"; src: string; altKey: string }
  | { kind: "links"; items: Array<{ key: string; href: string }> };

export interface GuideSubstep {
  /** Full anchor id, e.g. "install-download". */
  id: string;
  /** i18n key for the sub-step heading (also the sidebar tree label). */
  titleKey: string;
  blocks: GuideBlock[];
}

export interface GuideStep {
  /** Section anchor id (also the deep-link target). */
  id: GuideSectionId;
  /** 1-based step number shown in the tree and body. */
  num: number;
  /** i18n key for the section title. */
  titleKey: string;
  /** i18n key for the short section intro paragraph. */
  introKey: string;
  substeps: GuideSubstep[];
}

/**
 * The 6-step guide. Every `*Key` resolves under the `guide` namespace; the
 * message catalogs mirror this exact key tree in ko/en/ja.
 */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "install",
    num: 1,
    titleKey: "install.title",
    introKey: "install.intro",
    substeps: [
      {
        id: "install-download",
        titleKey: "install.download.title",
        blocks: [
          { kind: "text", key: "install.download.body" },
          {
            kind: "links",
            items: [{ key: "install.download.cta", href: "/download" }],
          },
          {
            kind: "shot",
            src: "/images/guide/install-download.svg",
            altKey: "install.download.alt",
          },
        ],
      },
      {
        id: "install-run",
        titleKey: "install.run.title",
        blocks: [
          { kind: "text", key: "install.run.body" },
          { kind: "callout", variant: "warn", key: "install.run.warn" },
          {
            kind: "shot",
            src: "/images/guide/install-run.svg",
            altKey: "install.run.alt",
          },
        ],
      },
      {
        id: "install-autocli",
        titleKey: "install.autocli.title",
        blocks: [
          { kind: "text", key: "install.autocli.body" },
          { kind: "callout", variant: "note", key: "install.autocli.note" },
          {
            kind: "shot",
            src: "/images/guide/install-autocli.svg",
            altKey: "install.autocli.alt",
          },
        ],
      },
    ],
  },
  {
    id: "auth",
    num: 2,
    titleKey: "auth.title",
    introKey: "auth.intro",
    substeps: [
      {
        id: "auth-claude",
        titleKey: "auth.claude.title",
        blocks: [
          { kind: "text", key: "auth.claude.body" },
          { kind: "code", code: "claude login" },
        ],
      },
      {
        id: "auth-codex",
        titleKey: "auth.codex.title",
        blocks: [
          { kind: "text", key: "auth.codex.body" },
          { kind: "code", code: "codex login" },
        ],
      },
      {
        id: "auth-antigravity",
        titleKey: "auth.antigravity.title",
        blocks: [
          { kind: "text", key: "auth.antigravity.body" },
          {
            kind: "callout",
            variant: "note",
            key: "auth.antigravity.note",
          },
        ],
      },
      {
        id: "auth-verify",
        titleKey: "auth.verify.title",
        blocks: [
          { kind: "text", key: "auth.verify.body" },
          { kind: "callout", variant: "tip", key: "auth.verify.tip" },
        ],
      },
    ],
  },
  {
    id: "project",
    num: 3,
    titleKey: "project.title",
    introKey: "project.intro",
    substeps: [
      {
        id: "project-add",
        titleKey: "project.add.title",
        blocks: [
          { kind: "text", key: "project.add.body" },
          { kind: "callout", variant: "tip", key: "project.add.tip" },
          {
            kind: "shot",
            src: "/images/guide/project-add.svg",
            altKey: "project.add.alt",
          },
        ],
      },
      {
        id: "project-orchestrator",
        titleKey: "project.orchestrator.title",
        blocks: [
          { kind: "text", key: "project.orchestrator.body" },
          {
            kind: "callout",
            variant: "note",
            key: "project.orchestrator.note",
          },
          {
            kind: "shot",
            src: "/images/guide/project-orchestrator.svg",
            altKey: "project.orchestrator.alt",
          },
        ],
      },
    ],
  },
  {
    id: "mission",
    num: 4,
    titleKey: "mission.title",
    introKey: "mission.intro",
    substeps: [
      {
        id: "mission-create",
        titleKey: "mission.create.title",
        blocks: [
          { kind: "text", key: "mission.create.body" },
          {
            kind: "shot",
            src: "/images/guide/mission-create.svg",
            altKey: "mission.create.alt",
          },
        ],
      },
      {
        id: "mission-run",
        titleKey: "mission.run.title",
        blocks: [{ kind: "text", key: "mission.run.body" }],
      },
      {
        id: "mission-review",
        titleKey: "mission.review.title",
        blocks: [
          { kind: "text", key: "mission.review.body" },
          { kind: "callout", variant: "warn", key: "mission.review.warn" },
        ],
      },
    ],
  },
  {
    id: "billing",
    num: 5,
    titleKey: "billing.title",
    introKey: "billing.intro",
    substeps: [
      {
        id: "billing-plans",
        titleKey: "billing.plans.title",
        blocks: [
          { kind: "text", key: "billing.plans.body" },
          { kind: "callout", variant: "note", key: "billing.plans.note" },
          {
            kind: "links",
            items: [{ key: "billing.plans.cta", href: "/pricing" }],
          },
        ],
      },
      {
        id: "billing-manage",
        titleKey: "billing.manage.title",
        blocks: [
          { kind: "text", key: "billing.manage.body" },
          {
            kind: "links",
            items: [{ key: "billing.manage.cta", href: "/my/lectures" }],
          },
        ],
      },
    ],
  },
  {
    id: "faq",
    num: 6,
    titleKey: "faq.title",
    introKey: "faq.intro",
    substeps: [
      {
        id: "faq-links",
        titleKey: "faq.links.title",
        blocks: [
          { kind: "text", key: "faq.links.body" },
          {
            kind: "links",
            items: [
              { key: "faq.links.faq", href: "/faq" },
              { key: "faq.links.founders", href: "/founders" },
              { key: "faq.links.bugs", href: "/bugs" },
              { key: "faq.links.download", href: "/download" },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * Flat list of every anchor id in document order (sections interleaved with
 * their sub-steps). The scroll-spy observer walks this to pick the active id.
 */
export const GUIDE_ANCHOR_IDS: string[] = GUIDE_STEPS.flatMap((s) => [
  s.id,
  ...s.substeps.map((sub) => sub.id),
]);
