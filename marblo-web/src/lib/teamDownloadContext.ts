/**
 * 수락(g) → 다운로드(i) 사이의 조직 문맥 한 줄(#1338 §3.2 (i)).
 *
 * `/download` 는 개인(Pro) 경로와 공유하는 페이지라 ★게이트를 달지 않는다 —
 * 조직 문맥일 때 상단 배너 한 줄("<조직> 팀원으로 설치합니다")만 얹는다.
 *
 * 문맥 전달은 URL 파라미터가 아니라 sessionStorage 다. URL 로 실으면 누구나
 * `?org=...` 를 만들어 임의 문구 배너를 띄울 수 있고, 그 링크가 공유되며
 * 개인 경로에도 배너가 새어 나간다. sessionStorage 는 수락 화면을 실제로
 * 거친 탭에만 남고, 탭이 닫히면 사라진다 — 정확히 필요한 수명이다.
 */

export const TEAM_DOWNLOAD_CONTEXT_KEY = "marblo_team_download_ctx";

/** 수락 후 다운로드까지 걸릴 상식적 시간 — 지나면 배너를 그리지 않는다. */
export const TEAM_DOWNLOAD_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

/** 배너에 그릴 수 있는 표시명 길이 상한(서버 검증과 별개의 화면 위생). */
const MAX_DISPLAY_NAME_LENGTH = 80;

export interface TeamDownloadContext {
  orgDisplayName: string;
  savedAtMs: number;
}

/**
 * 저장된 원문 → 문맥. ★신뢰 경계 — 어떤 원문이 와도 던지지 않고, 만료·손상·
 * 과대 입력은 전부 null(배너 없음 = 개인 경로 기본 화면)로 접는다.
 */
export function parseTeamDownloadContext(
  raw: string | null,
  nowMs: number
): TeamDownloadContext | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const name =
    typeof rec.orgDisplayName === "string" ? rec.orgDisplayName.trim() : "";
  const savedAtMs =
    typeof rec.savedAtMs === "number" && Number.isFinite(rec.savedAtMs)
      ? rec.savedAtMs
      : null;
  if (!name || name.length > MAX_DISPLAY_NAME_LENGTH || savedAtMs === null) {
    return null;
  }
  if (nowMs - savedAtMs > TEAM_DOWNLOAD_CONTEXT_TTL_MS || savedAtMs > nowMs) {
    return null;
  }
  return { orgDisplayName: name, savedAtMs };
}

/** 수락 화면이 부른다. 저장 실패(프라이빗 모드 등)는 배너 하나 잃는 일이다. */
export function saveTeamDownloadContext(orgDisplayName: string): void {
  const name = orgDisplayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  if (!name) return;
  try {
    window.sessionStorage.setItem(
      TEAM_DOWNLOAD_CONTEXT_KEY,
      JSON.stringify({ orgDisplayName: name, savedAtMs: Date.now() })
    );
  } catch {
    // 무시 — 배너는 편의지 기능 게이트가 아니다.
  }
}

/** 다운로드 화면이 부른다. 없거나 만료면 null — 개인 경로 기본 화면 그대로. */
export function readTeamDownloadContext(): TeamDownloadContext | null {
  try {
    return parseTeamDownloadContext(
      window.sessionStorage.getItem(TEAM_DOWNLOAD_CONTEXT_KEY),
      Date.now()
    );
  } catch {
    return null;
  }
}
