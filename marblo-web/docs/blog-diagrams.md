# Blog inline-SVG diagram convention

Diagrams in blog posts are **inline SVG written directly in the `.mdx` body** —
no external image files, no `<img src>`, no PNG/JPG assets. This keeps posts
self-contained, theme-consistent, crisp at every zoom level, and fully rendered
into the static HTML (great for SEO/GEO — the label text is real text).

This is the shared spec for the whole blog. Every topic post should follow it so
the 10 posts read as one visual system. The reference implementation lives in
`content/blog/{ko,en}/what-is-marblo.mdx`.

## The pattern — wrap SVG in `<Diagram>`

```mdx
<Diagram caption="사람이 읽는 캡션 — 다이어그램이 말하는 요점 한 줄">
  <svg
    viewBox="0 0 640 360"
    role="img"
    aria-label="한 문장으로 다이어그램을 설명하는 접근성 라벨"
    style={{ width: "100%", height: "auto" }}
  >
    {/* shapes + text labels here */}
  </svg>
</Diagram>
```

`<Diagram>` is a component provided by the blog route
(`src/app/[locale]/blog/[slug]/page.tsx`). It renders a dark-theme
`<figure>` around your SVG and appends a styled `<figcaption>` from the
`caption` prop. You only write the `<svg>` and the caption text.

### Why `<Diagram>` and not a literal `<figure>`?

MDX compiles author-written **literal lowercase tags** (`<figure>`,
`<figcaption>`, `<svg>`) to **host elements**, which bypass the MDX `components`
map. So a hand-written `<figure>` would render **unstyled** — the route's
`figure`/`figcaption` overrides never reach it. A **capitalized** component like
`<Diagram>` _does_ resolve through the components map, so it's the single,
reliable styling source. (This is verified against this repo's MDX compiler, not
assumed — literal `<figure>` compiles to `"figure"`, not `_components.figure`.)

You still author the `<svg>` inline — only the `figure`/`figcaption` chrome moves
into the component.

## Hard rules (because MDX compiles to JSX / React)

next-mdx-remote compiles MDX to JSX, so an SVG in a post is **React**, not raw
HTML. That means:

- **Use `className`, not `class`.** `class` is silently dropped.
- **camelCase every hyphenated SVG attribute.** React needs the JSX spelling:
  - `viewBox` (already camelCase — keep it)
  - `stroke-width` → `strokeWidth`
  - `stroke-linecap` → `strokeLinecap`, `stroke-linejoin` → `strokeLinejoin`
  - `stroke-dasharray` → `strokeDasharray`
  - `text-anchor` → `textAnchor`
  - `font-size` → `fontSize`, `font-weight` → `fontWeight`, `font-family` → `fontFamily`
  - `dominant-baseline` → `dominantBaseline`
  - `marker-end` → `markerEnd`, and a `<marker>` needs `markerWidth` / `markerHeight` / `refX` / `refY` / `orient`
- **`style` is an object:** `style={{ width: "100%", height: "auto" }}` — not `style="..."`.
- **Comments are `{/* ... */}`**, not `<!-- ... -->`.
- **No `xmlns` needed** — inline React SVG doesn't require it.
- **`caption` is a JSX string attribute** — avoid raw double quotes inside it
  (use typographic quotes or restructure). Korean/`·`/`—` are fine.

## Responsiveness

- Always set a `viewBox` and let the SVG scale: `style={{ width: "100%", height: "auto" }}`.
- Do **not** hardcode `width`/`height` attributes (they'd fight the fluid style).
- Design the coordinate space so it reads on a ~360px-wide phone. Keep label
  `fontSize` ≥ 11 (in viewBox units) and give boxes breathing room.
- The `<figure>` that `<Diagram>` renders already adds `overflow-x-auto`, so a
  wide diagram scrolls instead of breaking the page — but prefer a viewBox that
  fits without scrolling.

## Accessibility

- `role="img"` + a descriptive `aria-label` on the `<svg>` (one sentence, the
  same information a sighted reader gets).
- Put **real `<text>` labels inside** the diagram — never rely on color alone to
  carry meaning. Screen readers get the aria-label; everyone else gets on-canvas
  text.
- The `caption` restates the takeaway in prose.

## Brand palette (dark theme)

Matches the blog's existing prose tokens (`text-white`, `text-zinc-300`,
`indigo-*`). Use these exact hex values so diagrams across posts stay coherent:

| Role                                            | Hex       | Token       |
| ----------------------------------------------- | --------- | ----------- |
| Node fill                                       | `#27272a` | zinc-800    |
| Node fill (muted band)                          | `#18181b` | zinc-900    |
| Node border                                     | `#3f3f46` | zinc-700    |
| Primary accent (orchestrator, arrows, emphasis) | `#6366f1` | indigo-500  |
| Agent — Claude                                  | `#818cf8` | indigo-400  |
| Agent — Codex                                   | `#34d399` | emerald-400 |
| Agent — Antigravity                             | `#38bdf8` | sky-400     |
| Label text (strong)                             | `#e4e4e7` | zinc-200    |
| Label text (muted)                              | `#a1a1aa` | zinc-400    |
| Kanban REVIEW accent                            | `#fbbf24` | amber-400   |

Conventions:

- Boxes: `fill="#27272a"`, `stroke="#3f3f46"`, `rx="8"` (rounded), `strokeWidth="1.5"`.
- Emphasis box (orchestrator): keep the zinc fill but use `stroke="#6366f1"`.
- Arrows: `stroke="#6366f1"`, `strokeWidth="2"`, with a shared arrowhead `<marker>`.
- Use `fontFamily="ui-sans-serif, system-ui, sans-serif"` on text for a native look.

## Reusable arrowhead

Define one `<marker>` in `<defs>` and reference it with `markerEnd`:

```mdx
<defs>
  <marker
    id="arrow-fanout"
    markerWidth="10"
    markerHeight="10"
    refX="8"
    refY="3"
    orient="auto"
  >
    <path d="M0,0 L8,3 L0,6 Z" fill="#6366f1" />
  </marker>
</defs>
<line
  x1="100"
  y1="80"
  x2="200"
  y2="80"
  stroke="#6366f1"
  strokeWidth="2"
  markerEnd="url(#arrow-fanout)"
/>
```

**Give each marker a unique `id` per diagram** (e.g. `arrow-fanout`,
`arrow-kanban`, `arrow-stack`). Multiple inline SVGs render into one page, so
duplicate ids across diagrams on the same page can collide.

## Reference implementation

See `content/blog/{ko,en}/what-is-marblo.mdx` for three worked diagrams:

1. **Orchestrator → agent fan-out** — one orchestrator distributing tasks to
   heterogeneous agents (`viewBox="0 0 640 340"`).
2. **Kanban lifecycle** — TODO → IN_PROGRESS → REVIEW → DONE (`viewBox="0 0 720 180"`).
3. **Heterogeneous model composition** — BYO-model agents over an MCP + local
   layer (`viewBox="0 0 640 400"`).

Copy those as starting points; swap labels and re-color per the table above.
