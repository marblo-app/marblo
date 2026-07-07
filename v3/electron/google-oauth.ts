/**
 * System-browser loopback OAuth for the packaged app (Google sign-in, B안).
 *
 * Why this exists (ticket QvaYPAjAW822I0IDiwwZ, spec docs/GOOGLE_LOGIN_PACKAGED.md):
 *   The packaged app is served from a custom `http://127.0.0.1:<random port>`
 *   origin (electron main's static http server), not the Firebase authDomain.
 *   On that origin the Firebase JS SDK's `signInWithRedirect` silently hangs —
 *   storage partitioning stops the top-level navigation from ever starting
 *   (v3.0.5 console: `persistence set → signInWithRedirect` then
 *   `no navigation within 8000ms`). It cannot be worked around in web code.
 *
 * The fix is the desktop-app standard (Google "OAuth 2.0 for Mobile & Desktop
 * Apps", RFC 8252): open the system browser to Google's authorize endpoint,
 * catch the redirect on a throwaway 127.0.0.1 loopback server, exchange the
 * authorization code for tokens using PKCE, and hand the resulting `id_token`
 * back to the renderer, which finishes with `signInWithCredential`. The app
 * window never navigates, so renderer state (terminals/agents) is preserved.
 *
 * Security:
 *   - PKCE (S256) — no confidential client secret required in the flow. For
 *     Google "Desktop app" clients the token endpoint still expects the
 *     (non-confidential) client secret, so we forward it when configured.
 *   - `state` parameter — CSRF defense; the loopback response is rejected
 *     unless the returned state matches the one we generated.
 *   - The redirect only ever binds to 127.0.0.1 (loopback), never 0.0.0.0.
 *
 * Config (main process owns these; the renderer only ever receives the final
 * id_token, never the client id/secret from here):
 *   VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID     — required to enable the flow.
 *   GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET      — optional; Google Desktop clients
 *                                             issue a non-confidential secret
 *                                             that the token endpoint expects.
 */
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { shell } from "electron";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// The system-browser leg can take a while (account chooser, consent, 2FA). Give
// the user a generous window before we tear the loopback server down and report
// a timeout rather than leaking the listener forever.
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface GoogleLoopbackResult {
  ok: boolean;
  /** OpenID Connect id_token — fed to GoogleAuthProvider.credential in the renderer. */
  idToken?: string;
  /** OAuth access_token — passed alongside so Firebase can populate provider data. */
  accessToken?: string;
  /** User-facing (Korean) error message when ok=false. */
  error?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Minimal HTML shown in the system browser after the redirect lands. */
function browserResponse(ok: boolean): string {
  const title = ok ? "로그인 완료" : "로그인 실패";
  const body = ok
    ? "Marblo 로그인이 완료되었습니다. 이 창을 닫고 앱으로 돌아가세요."
    : "로그인에 실패했습니다. 이 창을 닫고 앱에서 다시 시도해 주세요.";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b0b0f;color:#e5e5ea;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}main{text-align:center;padding:2rem;max-width:28rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#9a9aa2;line-height:1.5}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

/**
 * Run the full loopback OAuth flow. Resolves with the tokens on success, or
 * `{ ok: false, error }` on any failure (never rejects — the renderer branches
 * on `ok`). The temporary loopback server is always closed before resolving.
 */
export async function runGoogleLoopbackOAuth(): Promise<GoogleLoopbackResult> {
  const clientId = process.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET?.trim();

  if (!clientId) {
    return {
      ok: false,
      error:
        "Desktop OAuth client 미설정: VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID 환경변수를 설정하세요. (docs/GOOGLE_LOGIN_PACKAGED.md 참고)",
    };
  }

  // PKCE: verifier is a high-entropy random string; challenge is its SHA-256
  // (S256). code_challenge goes in the authorize URL, code_verifier in the
  // token exchange — an interceptor of the auth code cannot redeem it.
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );
  // CSRF token echoed back on the redirect; mismatch → reject.
  const state = base64url(crypto.randomBytes(16));

  return new Promise<GoogleLoopbackResult>((resolve) => {
    let settled = false;

    const finish = (result: GoogleLoopbackResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Give the browser a moment to receive the response body before closing.
      try {
        server.close();
      } catch {
        // already closed / never listened — nothing to do
      }
      resolve(result);
    };

    const server = http.createServer(async (req, res) => {
      // Ignore favicon and any stray path — only the redirect on "/" matters.
      let reqUrl: URL;
      try {
        reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (reqUrl.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }

      const params = reqUrl.searchParams;
      const errorParam = params.get("error");
      const returnedState = params.get("state");
      const code = params.get("code");

      const sendHtml = (ok: boolean) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(browserResponse(ok));
      };

      if (errorParam) {
        sendHtml(false);
        finish({ ok: false, error: `Google OAuth 거부됨: ${errorParam}` });
        return;
      }
      // CSRF: constant-time compare of the echoed state. Compare BYTE lengths
      // (not JS string .length) so a multibyte returnedState can never make
      // timingSafeEqual throw on a length mismatch — our own state is ASCII
      // base64url, so a mismatch is the only outcome for anything unexpected.
      const returnedStateBuf = returnedState
        ? Buffer.from(returnedState)
        : Buffer.alloc(0);
      const stateBuf = Buffer.from(state);
      if (
        !returnedState ||
        returnedStateBuf.length !== stateBuf.length ||
        !crypto.timingSafeEqual(returnedStateBuf, stateBuf)
      ) {
        sendHtml(false);
        finish({
          ok: false,
          error:
            "state 불일치 — 로그인 요청이 검증되지 않았습니다 (CSRF 방어).",
        });
        return;
      }
      if (!code) {
        sendHtml(false);
        finish({ ok: false, error: "authorization code 를 받지 못했습니다." });
        return;
      }

      try {
        const port = (server.address() as AddressInfo).port;
        const redirectUri = `http://127.0.0.1:${port}`;
        const body = new URLSearchParams({
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        });
        // Google Desktop clients expect the (non-confidential) secret here.
        if (clientSecret) body.set("client_secret", clientSecret);

        const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const json = (await tokenRes.json().catch(() => ({}))) as {
          id_token?: string;
          access_token?: string;
          error?: string;
          error_description?: string;
        };

        if (!tokenRes.ok || !json.id_token) {
          const detail =
            json.error_description || json.error || `HTTP ${tokenRes.status}`;
          sendHtml(false);
          finish({ ok: false, error: `토큰 교환 실패: ${detail}` });
          return;
        }

        sendHtml(true);
        finish({
          ok: true,
          idToken: json.id_token,
          accessToken: json.access_token,
        });
      } catch (e) {
        sendHtml(false);
        finish({
          ok: false,
          error: `토큰 교환 중 오류: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    });

    server.on("error", (e) => {
      finish({ ok: false, error: `로컬 로그인 서버 오류: ${e.message}` });
    });

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: "로그인 시간이 초과되었습니다 (5분). 다시 시도해 주세요.",
      });
    }, OAUTH_TIMEOUT_MS);

    // Bind to loopback with an OS-assigned port (listen 0) so we never need a
    // fixed redirect_uri registered — a "Desktop app" OAuth client accepts any
    // 127.0.0.1 port.
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "select_account",
        state,
      });
      // If the system browser can't be opened at all, fail fast instead of
      // leaving the user staring at nothing until the 5-minute timeout.
      shell
        .openExternal(`${GOOGLE_AUTH_ENDPOINT}?${authParams.toString()}`)
        .catch(() =>
          finish({
            ok: false,
            error: "브라우저를 열지 못했습니다. 다시 시도해 주세요.",
          }),
        );
    });
  });
}
