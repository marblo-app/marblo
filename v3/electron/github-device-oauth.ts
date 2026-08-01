/** GitHub OAuth device authorization grant (RFC 8628). */

const DEVICE_CODE_ENDPOINT = "https://github.com/login/device/code";
const ACCESS_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

export interface GitHubDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export type DevicePollState =
  | { kind: "pending"; nextIntervalSeconds: number }
  | { kind: "slow_down"; nextIntervalSeconds: number }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "success"; accessToken: string }
  | { kind: "error"; message: string };

interface GitHubDeviceCodeResponse {
  device_code?: unknown;
  user_code?: unknown;
  verification_uri?: unknown;
  verification_uri_complete?: unknown;
  expires_in?: unknown;
  interval?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface GitHubTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Pure state transition for one access-token polling response. */
export function parseDevicePollResponse(
  response: GitHubTokenResponse,
  currentIntervalSeconds: number,
): DevicePollState {
  const token = stringField(response.access_token);
  if (token && response.token_type === "bearer") {
    return { kind: "success", accessToken: token };
  }

  switch (response.error) {
    case "authorization_pending":
      return { kind: "pending", nextIntervalSeconds: currentIntervalSeconds };
    case "slow_down":
      return { kind: "slow_down", nextIntervalSeconds: currentIntervalSeconds + 5 };
    case "expired_token":
      return { kind: "expired" };
    case "access_denied":
      return { kind: "denied" };
    default:
      return {
        kind: "error",
        message:
          stringField(response.error_description) ??
          "GitHub 연결 상태를 확인할 수 없습니다. 잠시 후 다시 시도하세요.",
      };
  }
}

export async function requestGitHubDeviceCode(
  clientId: string,
  fetcher: FetchLike = fetch,
): Promise<GitHubDeviceCode> {
  const response = await fetcher(DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "repo" }).toString(),
  });
  const body = (await responseJson(response)) as GitHubDeviceCodeResponse | null;
  const deviceCode = stringField(body?.device_code);
  const userCode = stringField(body?.user_code);
  const verificationUri = stringField(body?.verification_uri);
  const expiresIn = body?.expires_in;
  const interval = body?.interval;
  if (!response.ok || !deviceCode || !userCode || !verificationUri || !isPositiveInteger(expiresIn)) {
    throw new Error("GitHub 디바이스 코드를 시작하지 못했습니다.");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(stringField(body?.verification_uri_complete)
      ? { verificationUriComplete: stringField(body?.verification_uri_complete)! }
      : {}),
    expiresIn,
    interval: isPositiveInteger(interval) ? interval : 5,
  };
}

export async function pollGitHubDeviceCode(
  clientId: string,
  deviceCode: string,
  currentIntervalSeconds: number,
  fetcher: FetchLike = fetch,
): Promise<DevicePollState> {
  try {
    const response = await fetcher(ACCESS_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString(),
    });
    const body = (await responseJson(response)) as GitHubTokenResponse | null;
    if (!body) return { kind: "error", message: "GitHub 응답을 읽지 못했습니다. 다시 시도하세요." };
    return parseDevicePollResponse(body, currentIntervalSeconds);
  } catch {
    return { kind: "error", message: "GitHub에 연결하지 못했습니다. 네트워크를 확인하세요." };
  }
}
