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
 * ── 두 소비자 ────────────────────────────────────────────────────────────────
 * 이 파일은 두 흐름이 공유한다. 로그인(`runGoogleLoopbackOAuth`, scope=openid
 * email profile)과 **Google Drive 연결**(`google-drive-auth.ts`, scope=
 * drive.readonly). 둘 다 같은 앱 단위 desktop OAuth client 를 쓰지만 **동의는
 * 따로** 받는다(= OAuth 의 incremental authorization). 로그인 때 Drive 스코프를
 * 같이 요구하지 않는 이유는 google-drive-auth.ts 머리주석에 적어 두었다.
 *
 * Security:
 *   - PKCE (S256) — no confidential client secret required in the flow. For
 *     Google "Desktop app" clients the token endpoint still expects the
 *     (non-confidential) client secret, so we forward it when configured.
 *   - `state` parameter — CSRF defense; the loopback response is rejected
 *     unless the returned state matches the one we generated.
 *   - The redirect only ever binds to 127.0.0.1 (loopback), never 0.0.0.0.
 *   - 토큰 값은 이 모듈의 어떤 로그에도 남지 않는다(반환값으로만 전달).
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
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

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

/** 앱 단위 단일 desktop OAuth client. 두 흐름(로그인·Drive)이 같은 값을 쓴다. */
export interface GoogleDesktopOAuthClient {
  clientId: string;
  clientSecret?: string;
}

/**
 * 설정된 desktop OAuth client. 없으면 null — 호출자가 각자의 안내 문구로 실패를
 * 만든다(패키지앱은 build-resources/oauth-config.json, dev 는 v3/.env 에서 온다).
 */
export function googleDesktopOAuthClient(
  env: NodeJS.ProcessEnv = process.env,
): GoogleDesktopOAuthClient | null {
  const clientId = env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID?.trim();
  if (!clientId) return null;
  const clientSecret = env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET?.trim();
  return clientSecret ? { clientId, clientSecret } : { clientId };
}

/** Google 토큰 엔드포인트가 돌려주는 값들 중 우리가 쓰는 것만. */
export interface GoogleTokenSet {
  idToken?: string;
  accessToken?: string;
  /** 장기 재발급용. `prompt=consent` 로 새로 동의를 받은 요청에서만 온다. */
  refreshToken?: string;
  /** access_token 수명(초). */
  expiresInSeconds?: number;
  /** 실제로 부여된 스코프(공백 구분) — 요청한 것과 다를 수 있다. */
  scope?: string;
}

export type LoopbackAuthorizeResult =
  | { ok: true; tokens: GoogleTokenSet }
  | { ok: false; error: string };

/** 브라우저 결과 페이지 문구(흐름마다 다르다). */
export interface LoopbackBrowserLabels {
  okTitle: string;
  okBody: string;
  failTitle: string;
  failBody: string;
}

export interface LoopbackAuthorizeRequest {
  client: GoogleDesktopOAuthClient;
  /** 공백 구분 스코프 문자열. */
  scope: string;
  /**
   * authorize URL 에 추가로 얹을 파라미터. `prompt`, `access_type`,
   * `include_granted_scopes`, `login_hint` 등. 여기서 준 값이 기본값을 덮는다.
   */
  extraAuthParams?: Record<string, string>;
  labels: LoopbackBrowserLabels;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Minimal HTML shown in the system browser after the redirect lands. */
function browserResponse(ok: boolean, labels: LoopbackBrowserLabels): string {
  const title = ok ? labels.okTitle : labels.failTitle;
  const body = ok ? labels.okBody : labels.failBody;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b0b0f;color:#e5e5ea;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}main{text-align:center;padding:2rem;max-width:28rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#9a9aa2;line-height:1.5}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

const LOGIN_LABELS: LoopbackBrowserLabels = {
  okTitle: "로그인 완료",
  okBody: "Marblo 로그인이 완료되었습니다. 이 창을 닫고 앱으로 돌아가세요.",
  failTitle: "로그인 실패",
  failBody: "로그인에 실패했습니다. 이 창을 닫고 앱에서 다시 시도해 주세요.",
};

/**
 * 루프백 authorization-code + PKCE 흐름 한 판. 성공하면 토큰 세트를, 실패하면
 * 한국어 사유를 돌려준다(절대 reject 하지 않는다 — 호출자는 `ok` 로 분기).
 * 임시 루프백 서버는 resolve 전에 항상 닫힌다.
 */
export async function runGoogleLoopbackAuthorization(
  request: LoopbackAuthorizeRequest,
): Promise<LoopbackAuthorizeResult> {
  const { client, scope, extraAuthParams, labels } = request;

  // PKCE: verifier is a high-entropy random string; challenge is its SHA-256
  // (S256). code_challenge goes in the authorize URL, code_verifier in the
  // token exchange — an interceptor of the auth code cannot redeem it.
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );
  // CSRF token echoed back on the redirect; mismatch → reject.
  const state = base64url(crypto.randomBytes(16));

  return new Promise<LoopbackAuthorizeResult>((resolve) => {
    let settled = false;

    const finish = (result: LoopbackAuthorizeResult) => {
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
        res.end(browserResponse(ok, labels));
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
          client_id: client.clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        });
        // Google Desktop clients expect the (non-confidential) secret here.
        if (client.clientSecret) body.set("client_secret", client.clientSecret);

        const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const json = (await tokenRes.json().catch(() => ({}))) as {
          id_token?: string;
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
          error?: string;
          error_description?: string;
        };

        if (!tokenRes.ok || (!json.id_token && !json.access_token)) {
          const detail =
            json.error_description || json.error || `HTTP ${tokenRes.status}`;
          sendHtml(false);
          finish({ ok: false, error: `토큰 교환 실패: ${detail}` });
          return;
        }

        sendHtml(true);
        finish({
          ok: true,
          tokens: {
            idToken: json.id_token,
            accessToken: json.access_token,
            refreshToken: json.refresh_token,
            expiresInSeconds:
              typeof json.expires_in === "number" ? json.expires_in : undefined,
            scope: json.scope,
          },
        });
      } catch (e) {
        sendHtml(false);
        finish({
          ok: false,
          error: `토큰 교환 중 오류: ${
            e instanceof Error ? e.message : String(e)
          }`,
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
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "select_account",
        state,
      });
      for (const [key, value] of Object.entries(extraAuthParams ?? {})) {
        if (value) authParams.set(key, value);
      }
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

/**
 * Run the full loopback OAuth flow for **sign-in**. Resolves with the tokens on
 * success, or `{ ok: false, error }` on any failure (never rejects — the
 * renderer branches on `ok`).
 */
export async function runGoogleLoopbackOAuth(): Promise<GoogleLoopbackResult> {
  const client = googleDesktopOAuthClient();
  if (!client) {
    return {
      ok: false,
      error:
        "Desktop OAuth client 미설정: VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID 환경변수를 설정하세요. (docs/GOOGLE_LOGIN_PACKAGED.md 참고)",
    };
  }

  const result = await runGoogleLoopbackAuthorization({
    client,
    scope: "openid email profile",
    labels: LOGIN_LABELS,
  });
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.tokens.idToken) {
    return { ok: false, error: "토큰 교환 실패: id_token 이 없습니다." };
  }
  return {
    ok: true,
    idToken: result.tokens.idToken,
    accessToken: result.tokens.accessToken,
  };
}
