/**
 * slack-health — Slack Web API 저수준 호출 + 채널 헬스 프로브.
 *
 * telegram-health.ts 를 그대로 미러링한다: 저수준 `slackApi()` 한 개를 인바운드
 * (slack-poller 의 connections.open)와 아웃바운드(chat.postMessage)와 헬스 프로브가
 * 공유하고, 토큰은 어떤 로그/에러/반환값에도 나타나지 않는다(scrubSlackTokens).
 *
 * ★텔레그램과 다른 점 (Slack 의 현실이 강제하는 것만):
 *   1. 인증이 URL path 가 아니라 `Authorization: Bearer` 헤더다. 그래서 토큰이
 *      URL 에 실리지 않는 대신, 에러 문자열 스크럽은 그대로 유지한다(방어).
 *   2. Slack 은 HTTP 200 + `{ok:false, error:"..."}` 로 실패를 알린다. 그래서
 *      "2xx 인데 ok:false" 는 텔레그램과 마찬가지로 **비재시도 애플리케이션
 *      에러**로 취급한다 — 단, `ratelimited` 만 예외로 재시도 대상이다.
 *   3. getWebhookInfo 같은 "폴러가 귀먹었는지" 계기판이 없다. Socket Mode 는
 *      연결 자체가 살아 있는지를 우리가 직접 아는 구조라, 여기서의 헬스는
 *      "자격증명이 아직 유효한가"(auth.test)를 본다. 연결 생사는 slack-poller 의
 *      getRouteHealth 가 답한다 — 두 신호를 합쳐야 "왜 조용한가"를 알 수 있다.
 *
 * 불변식: 절대 throw 하지 않는 프로브(네트워크 안전 — 막힌 프로브가 wake 핸들러를
 * 막으면 안 된다), 토큰을 로그/반환하지 않는다.
 */

import {
  listSlackChannelConfigs,
  isSlackChannelActive,
} from "./slack-channels";

const SLACK_API = "https://slack.com/api";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 진단 문자열에서 토큰을 지운다. 텔레그램의 scrubToken 과 같은 역할이되 Slack 은
 * 토큰이 둘(xoxb/xapp)이라 가변 인자를 받는다. 빈 토큰은 no-op.
 */
export function scrubSlackTokens(
  msg: string,
  ...tokens: (string | null | undefined)[]
): string {
  let out = msg;
  for (const token of tokens) {
    if (!token) continue;
    out = out.split(token).join("<token>");
  }
  return out;
}

/** 파싱된 Slack Web API 응답 봉투. `ok:false` 면 `error` 에 사유 코드가 온다. */
export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Bot API 의 non-2xx 응답. 상태코드와 (429 의) `Retry-After` 초를 실어 아웃바운드
 * 호출자가 재시도 여부/대기시간을 정할 수 있게 한다. TelegramHttpError 의 형제.
 */
export class SlackHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = "SlackHttpError";
  }
}

/** {@link slackApi} 한 번의 호출 옵션. */
export interface SlackApiOptions {
  /** 테스트 주입용 fetch. 기본은 전역 fetch. */
  fetchImpl?: typeof fetch;
  /** 요청 abort 타임아웃(ms). 기본 8000. */
  timeoutMs?: number;
}

/**
 * Slack Web API 메서드 하나를 하드 타임아웃과 함께 호출한다. params 는 JSON POST
 * 바디로 나가고(값이 URL/쿼리에 실리지 않는다), 토큰은 Authorization 헤더에만
 * 존재한다. 파싱된 봉투를 돌려주거나 네트워크/타임아웃/non-2xx 에 throw 한다.
 *
 * ★`ok:false` 는 throw 하지 않는다 — 호출자가 error 코드로 분기해야 하기 때문
 * (telegramApi 와 동일한 계약).
 */
export async function slackApi(
  token: string,
  method: string,
  params?: Record<string, unknown>,
  opts: SlackApiOptions = {},
): Promise<SlackApiResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Parameterless calls (auth.test, apps.connections.open) go out with NO
    // body: a few Web API methods still reject a JSON body, and an empty POST
    // is accepted by all of them. Methods that DO take arguments get a JSON
    // body, which keeps message text out of the URL — the same split
    // telegramApi makes.
    const init: RequestInit = {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    };
    if (params !== undefined) {
      init.headers = {
        ...(init.headers as Record<string, string>),
        "Content-Type": "application/json; charset=utf-8",
      };
      init.body = JSON.stringify(params);
    }
    const res = await fetchImpl(`${SLACK_API}/${method}`, init);
    if (!res.ok) {
      // 429 는 헤더로 Retry-After 를 준다(바디가 아니다 — 텔레그램과 다른 점).
      const raw = res.headers?.get?.("retry-after");
      const parsed = raw != null ? Number.parseInt(raw, 10) : Number.NaN;
      const retryAfter = Number.isFinite(parsed) ? parsed : undefined;
      throw new SlackHttpError(res.status, retryAfter, `HTTP ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: "malformed_response" };
    }
    return body as SlackApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** 단일 채널 헬스 프로브 결과. 시크릿을 담지 않는다. */
export interface SlackHealth {
  /** auth.test 가 ok:true 로 응답(자격증명 유효 + API 도달 가능). */
  ok: boolean;
  /** 봇의 Slack user id(멘션 판정 `<@Uxxx>` 에 쓰인다). 실패 시 null. */
  botUserId: string | null;
  /** 워크스페이스 team id. 실패 시 null. */
  teamId: string | null;
  /** app token 이 Socket Mode 자격을 갖췄는가(apps.connections.open 검증). */
  appTokenOk: boolean;
  /** 토큰 스크럽된 비치명 진단(ok=false 일 때). */
  error?: string;
}

export interface SlackProbeOptions {
  /** 테스트 주입용 fetch. */
  fetchImpl?: typeof fetch;
  /** 요청 타임아웃(ms). 기본 8000 — 막힌 프로브가 wake 를 막으면 안 된다. */
  timeoutMs?: number;
  /**
   * app token 까지 검증할지. 기본 false.
   * ★기본이 false 인 이유: 검증 수단인 apps.connections.open 은 **실제 WSS
   * 연결 슬롯을 하나 연다**(앱당 동시 연결 수에 상한이 있다). 주기 헬스 스윕이
   * 그걸 매번 부르면 폴러의 연결을 갉아먹으므로, app token 검증은 설정 저장
   * 직후처럼 사용자가 명시적으로 물었을 때만 켠다.
   */
  probeAppToken?: boolean;
}

/**
 * 채널 자격증명 헬스 프로브. auth.test 로 bot token 유효성과 봇 user id 를
 * 확인하고, 옵션에 따라 app token(Socket Mode)까지 검증한다. 절대 throw 안 함.
 */
export async function probeSlackChannel(
  botToken: string,
  appToken: string | null,
  opts: SlackProbeOptions = {},
): Promise<SlackHealth> {
  const bot = (botToken ?? "").trim();
  const app = (appToken ?? "").trim();
  const base: SlackHealth = {
    ok: false,
    botUserId: null,
    teamId: null,
    appTokenOk: false,
  };
  if (!bot) return { ...base, error: "empty bot token" };

  const apiOpts: SlackApiOptions = {
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  };

  let botUserId: string | null = null;
  let teamId: string | null = null;
  try {
    const auth = await slackApi(bot, "auth.test", undefined, apiOpts);
    if (!auth.ok) {
      return {
        ...base,
        error: scrubSlackTokens(
          `auth.test failed: ${String(auth.error ?? "unknown")}`,
          bot,
          app,
        ),
      };
    }
    botUserId = typeof auth.user_id === "string" ? auth.user_id : null;
    teamId = typeof auth.team_id === "string" ? auth.team_id : null;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ...base, error: scrubSlackTokens(raw, bot, app) };
  }

  let appTokenOk = false;
  if (opts.probeAppToken && app) {
    try {
      const open = await slackApi(
        app,
        "apps.connections.open",
        undefined,
        apiOpts,
      );
      appTokenOk = open.ok === true && typeof open.url === "string";
      if (!appTokenOk) {
        return {
          ok: true,
          botUserId,
          teamId,
          appTokenOk: false,
          error: scrubSlackTokens(
            `apps.connections.open failed: ${String(open.error ?? "unknown")} ` +
              `(app token 이 Socket Mode 용 xapp- 토큰이고 connections:write 스코프를 갖는지 확인하세요)`,
            bot,
            app,
          ),
        };
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return {
        ok: true,
        botUserId,
        teamId,
        appTokenOk: false,
        error: scrubSlackTokens(raw, bot, app),
      };
    }
  }

  return { ok: true, botUserId, teamId, appTokenOk };
}

/** 프로젝트별 헬스 리포트(렌더러/로그로 나가는 형태). 시크릿 없음. */
export interface SlackChannelHealthReport {
  projectId: string;
  health: SlackHealth;
}

/**
 * 활성 Slack 채널 전부의 자격증명 헬스를 훑는다. 텔레그램의
 * runTelegramChannelHealthCheck 와 같은 자리에서(wake · 주기 스윕) 호출된다.
 * 토큰 없음/비활성 채널은 건너뛴다. 절대 throw 안 함.
 *
 * `onReport` 는 렌더러 브로드캐스트 같은 부수효과용 콜백 — 이 모듈이 Electron
 * 의존을 갖지 않도록(그리고 유닛 테스트가 되도록) 콜백으로 남겨 둔다.
 */
export async function runSlackChannelHealthCheck(
  reason: string,
  opts: SlackProbeOptions & {
    onReport?: (report: SlackChannelHealthReport) => void;
  } = {},
): Promise<SlackChannelHealthReport[]> {
  let configs;
  try {
    configs = listSlackChannelConfigs();
  } catch {
    return [];
  }
  const active = configs.filter(
    (c) => c.botToken && isSlackChannelActive(c.projectId),
  );
  if (active.length === 0) return [];

  const { onReport, ...probeOpts } = opts;
  const reports: SlackChannelHealthReport[] = [];
  for (const cfg of active) {
    const health = await probeSlackChannel(
      cfg.botToken!,
      cfg.appToken,
      probeOpts,
    );
    const report: SlackChannelHealthReport = {
      projectId: cfg.projectId,
      health,
    };
    reports.push(report);

    if (!health.ok) {
      console.warn(
        `[SlackHealth:${reason}] project=${cfg.projectId} — 자격증명 프로브 실패: ${
          health.error ?? "unknown"
        }. Slack 인바운드/아웃바운드가 모두 멈춥니다 — 앱 설정에서 토큰을 다시 확인하세요.`,
      );
    } else if (health.error) {
      console.warn(
        `[SlackHealth:${reason}] project=${cfg.projectId} — bot token 은 유효하지만 ${health.error}`,
      );
    } else {
      console.log(
        `[SlackHealth:${reason}] project=${cfg.projectId} — 자격증명 정상 (bot=${
          health.botUserId ?? "?"
        } team=${health.teamId ?? "?"}).`,
      );
    }

    if (onReport) {
      try {
        onReport(report);
      } catch {
        // 깨진 리스너가 헬스 스윕을 깨뜨리면 안 된다.
      }
    }
  }
  return reports;
}
