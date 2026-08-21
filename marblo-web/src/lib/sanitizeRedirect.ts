/**
 * Validates a post-login `redirect` query parameter to prevent open-redirect /
 * phishing attacks.
 *
 * Only internal relative paths are allowed: the value must start with a single
 * `/` (i.e. match `^/(?!/)`). Everything else falls back to `fallback`:
 *   - protocol-relative URLs (`//evil.com`)
 *   - absolute URLs (`http://`, `https://`, any `scheme:` form)
 *   - backslash tricks (`/\evil.com`) — browsers normalize `\` to `/`
 *   - control characters that browsers may strip to smuggle past the check
 *
 * @param redirect The raw value from `searchParams.get('redirect')`.
 * @param fallback Safe internal default — build it with `localeHref(locale)`
 *   (src/i18n/routing.ts), never by hand, so it is not a URL that redirects.
 */
export function sanitizeRedirect(
  redirect: string | null | undefined,
  fallback: string
): string {
  if (!redirect) return fallback;

  // Reject backslashes (browsers normalize `\` → `/`, enabling `/\evil.com`
  // to become `//evil.com`).
  if (redirect.includes("\\")) return fallback;

  // Reject control characters (0x00–0x1F and 0x7F) which browsers may strip,
  // smuggling `//evil.com` or `http:` past the prefix checks below.
  for (let i = 0; i < redirect.length; i++) {
    const code = redirect.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return fallback;
  }

  // Allow only internal relative paths: start with `/` but not `//`.
  if (!/^\/(?!\/)/.test(redirect)) return fallback;

  return redirect;
}
