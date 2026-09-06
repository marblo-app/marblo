/**
 * Ticket nvrzSFU0xJMPuRqr0EeR: the app has no way to clear one site's stored
 * data inside a webtab pane. This is the pure decision core — no Electron
 * import — for scoping that clear to exactly one origin and refusing to run
 * without explicit confirmation. `main.ts` wires this to
 * `session.fromPartition(record.partition).clearStorageData(...)`; it never
 * decides scope or gating on its own.
 *
 * Deliberately origin-scoped, not partition-scoped: `persist:marblo-browser-tab`
 * holds every site the owner has ever visited in the webtab, and a
 * partition-wide reset would log the owner out of all of them to fix one
 * (see the ticket's naver.com redirect investigation).
 */

export type SiteDataOriginResult =
  | { ok: true; origin: string; host: string }
  | { ok: false; reason: "no-site" | "invalid-url" | "blocked-scheme" };

/** Only an actually-loaded http(s) page has clearable site data. */
export function resolveSiteDataOrigin(
  currentUrl: string,
): SiteDataOriginResult {
  if (!currentUrl || currentUrl === "about:blank") {
    return { ok: false, reason: "no-site" };
  }
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "blocked-scheme" };
  }
  return { ok: true, origin: url.origin, host: url.hostname };
}

/** Matches Electron's `ClearStorageDataOptions["storages"]` element union. */
export type ElectronClearableStorage =
  | "cookies"
  | "filesystem"
  | "indexdb"
  | "localstorage"
  | "shadercache"
  | "websql"
  | "serviceworkers"
  | "cachestorage";

export interface SiteDataCategory {
  id: "cookies" | "cache" | "serviceWorkers" | "localStorage";
  /** Electron `ClearStorageDataOptions.storages` values this category covers. */
  storages: readonly ElectronClearableStorage[];
}

/**
 * The four categories the ticket asks to name to the owner before clearing.
 * `storages` values are Electron's `Session.clearStorageData` vocabulary —
 * grouped under the ticket's four labels ("쿠키·캐시·서비스워커·로컬스토리지")
 * rather than Electron's own finer-grained names.
 */
export const SITE_DATA_CATEGORIES: readonly SiteDataCategory[] = [
  { id: "cookies", storages: ["cookies"] },
  { id: "cache", storages: ["cachestorage", "shadercache"] },
  { id: "serviceWorkers", storages: ["serviceworkers"] },
  {
    id: "localStorage",
    storages: ["localstorage", "indexdb", "websql", "filesystem"],
  },
];

export const SITE_DATA_STORAGES: readonly ElectronClearableStorage[] =
  SITE_DATA_CATEGORIES.flatMap((category) => category.storages);

/**
 * Ticket zYzwb3Q5hKT6o3Nl9aZh: `storages` passed to `clearStorageData` for the
 * "cookies" category. `clearStorageData({ origin, storages: ["cookies"] })`
 * only reaches cookies scoped to that exact origin — it never touches a
 * parent-domain cookie like `.naver.com` set while browsing
 * `recoshopping.naver.com`. But the preview modal lists every cookie the
 * *request* would carry (`session.cookies.get({ url })`), which includes
 * those parent-domain cookies. That mismatch is why a shown cookie could
 * survive "clear and reload" — the redirect loop the owner reported.
 *
 * Fix: cookies are cleared separately via `session.cookies.remove()` (see
 * `planCookieRemoval` below), driven by a fresh `cookies.get({ url })` call
 * made at clear-time — not by whatever the renderer's earlier preview said.
 * That gives a slightly different guarantee than "shown = cleared" would
 * literally read: it's "every cookie this origin carries *at the moment of
 * clearing* gets cleared", which can be a superset of what the preview
 * showed if the site set a new cookie in between (still same-origin only —
 * the origin gate elsewhere still blocks clearing any other site's data).
 * That's the safer direction to be wrong in, so the behavior stays; only the
 * documentation here and in `main.ts` should ever claim the *exact* guarantee.
 * `clearStorageData` still handles the other three categories, origin-scoped
 * as before — those are genuinely origin-partitioned by the platform, so
 * origin scope is already correct for them.
 */
export const SITE_DATA_NON_COOKIE_STORAGES: readonly ElectronClearableStorage[] =
  SITE_DATA_CATEGORIES.filter((category) => category.id !== "cookies").flatMap(
    (category) => category.storages,
  );

/**
 * The URL to pass to `session.cookies.remove(url, name)` so it actually
 * matches a given cookie, whatever domain that cookie is scoped to.
 * Electron/Chromium matches a cookie for removal against a URL the way it
 * would for sending it, so a host-only cookie (`domain: "example.com"`)
 * needs that exact host, and a domain cookie (`domain: ".naver.com"`, the
 * leading dot marking "this domain and all its subdomains") needs the dot
 * stripped before it can appear in a URL at all.
 */
export function cookieRemovalUrl(
  cookie: { domain?: string },
  protocol: string,
): string {
  const host = (cookie.domain ?? "").replace(/^\./, "");
  return `${protocol}//${host}`;
}

export interface CookieRemovalTarget {
  name: string;
  url: string;
}

/**
 * Maps whatever cookie list the caller hands it into `{ name, url }` pairs
 * for `session.cookies.remove(url, name)` — one call per cookie, since
 * Electron has no bulk-remove. Deliberately dumb: it has no notion of "the
 * preview" and takes exactly the list it's given, dropping only a cookie
 * with no domain at all (nothing to build a removal URL from). The caller
 * (`main.ts`) is what decides *which* list that is — currently a fresh
 * `cookies.get({ url: origin })` taken at clear-time, so the actual set
 * cleared is "this origin's cookies right now", not "the cookies the
 * preview happened to show earlier".
 */
export function planCookieRemoval(
  cookies: readonly { name: string; domain?: string }[],
  protocol: string,
): CookieRemovalTarget[] {
  return cookies
    .filter((cookie) => Boolean(cookie.domain))
    .map((cookie) => ({
      name: cookie.name,
      url: cookieRemovalUrl(cookie, protocol),
    }));
}

/**
 * True when clearing the previewed cookies reaches beyond the pane's own
 * origin host — i.e. at least one previewed cookie is scoped to a parent
 * domain (a leading-dot `domain`, or any domain that isn't the exact host).
 * Drives the modal's domain-scope warning: the owner must see this *before*
 * confirming, because clearing a parent-domain cookie can end sessions on
 * every subdomain of that domain, not just the one in this pane.
 */
export function broaderCookieDomains(
  cookies: readonly { domain: string }[],
  host: string,
): string[] {
  const domains = new Set<string>();
  for (const cookie of cookies) {
    const bare = cookie.domain.replace(/^\./, "");
    if (bare && bare !== host) domains.add(bare);
  }
  return [...domains].sort();
}

export type SiteDataClearDenyReason =
  | "pane-not-found"
  | "no-site"
  | "invalid-url"
  | "blocked-scheme"
  | "origin-changed"
  | "not-confirmed";

export type SiteDataClearDecision =
  | { allowed: true; origin: string; host: string }
  | { allowed: false; reason: SiteDataClearDenyReason };

export interface SiteDataClearRequestInput {
  /** False if the paneId no longer resolves to a live BrowserPaneRecord. */
  paneExists: boolean;
  /** The pane's current URL at the moment of the clear request. */
  currentUrl: string;
  /** Explicit owner confirmation from the confirm-step UI — never defaulted true. */
  confirmed: boolean;
  /**
   * The origin the confirm-step UI actually showed the owner (captured at
   * preview time). Required, not optional: a caller with no expectation to
   * assert has no business calling this at all. Guards a TOCTOU window —
   * the pane can navigate to a different site between "owner sees the
   * preview" and "owner clicks confirm", and the request must never clear
   * whatever site happens to be loaded *now* instead of the one the owner
   * actually agreed to.
   */
  expectedOrigin: string;
}

/**
 * Order is deliberate: a vanished pane is checked first (an irrelevant
 * confirmation flag on a pane that no longer exists should never read as
 * "would have cleared but wasn't confirmed"). Origin resolution comes next so
 * a bad/empty URL is reported precisely instead of collapsing into a less
 * specific reason. The origin-match check runs before the confirmation gate
 * — a stale confirmation for a since-navigated pane must be reported as
 * "origin-changed" (so the UI re-previews and asks again), not silently
 * treated as "not-confirmed" for the new site. The confirmation gate runs
 * last and unconditionally: it is the one check every other branch must
 * still pass through before this ever authorizes a `clearStorageData` call.
 */
export function classifySiteDataClearRequest(
  input: SiteDataClearRequestInput,
): SiteDataClearDecision {
  if (!input.paneExists) return { allowed: false, reason: "pane-not-found" };
  const origin = resolveSiteDataOrigin(input.currentUrl);
  if (!origin.ok) return { allowed: false, reason: origin.reason };
  if (input.expectedOrigin !== origin.origin) {
    return { allowed: false, reason: "origin-changed" };
  }
  if (!input.confirmed) return { allowed: false, reason: "not-confirmed" };
  return { allowed: true, origin: origin.origin, host: origin.host };
}

export interface SiteDataCookiePreview {
  name: string;
  domain: string;
  /** Seconds since epoch, or null for a session cookie. Never the cookie value. */
  expiresAt: number | null;
}

interface ElectronCookieLike {
  name: string;
  domain?: string;
  expirationDate?: number;
  session?: boolean;
}

/**
 * Strips an Electron `Cookie` down to name/domain/expiry for the pre-clear
 * preview — the ticket explicitly bans surfacing cookie **values**, only
 * name/domain/time.
 */
export function toCookiePreview(
  cookies: readonly ElectronCookieLike[],
): SiteDataCookiePreview[] {
  return cookies.map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain ?? "",
    expiresAt:
      cookie.session || cookie.expirationDate === undefined
        ? null
        : Math.round(cookie.expirationDate),
  }));
}
