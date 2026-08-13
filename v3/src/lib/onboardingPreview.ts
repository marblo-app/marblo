import type { CliModel } from "../stores/cliSetupStore";
import type { BulkInstallProgress, CliProbeLike } from "./oneClickSetup";
import type { FirstRunSampleStatus } from "../stores/firstRunSampleStore";

/**
 * ★온보딩 프리뷰 — 이미 설치·인증이 끝난 유저에게 **fresh 유저의 최초 연결단계**를
 * 그대로 다시 보여주는 개발/시연 모드 (티켓 MA5PnltkHBFbgcRvjo0r).
 *
 * 왜 필요한가: 원클릭 설치·자동 사인인·터미널 임베드·샘플 폴더 자동연결은 전부
 * "아직 아무것도 없는 기계" 에서만 그려진다. 개발 맥에는 CLI 가 깔려 있고 키체인에
 * 토큰이 있어서 `cliSetupStore.ready` 가 첫 프로브에 true 로 뒤집히고, 그 순간
 * 셸은 연결 게이트를 통째로 건너뛴다. 그래서 사장님은 자기가 주문한 화면을 라이브로
 * 볼 방법이 없었다(fresh 프로필을 새로 만드는 것 말고는).
 *
 * ★설계의 핵심은 **어디를 가로채는가**다. 가짜 값을 `cliSetupStore` 에 밀어 넣는
 * 방법은 쓰지 않는다 — 그 스토어의 `ready` 는 오케 자동기동(`marblo:cli-auth-ready`)
 * 과 스폰 게이트가 함께 읽는 값이라, 프리뷰가 그걸 false 로 만들면 진짜 오케가 안
 * 뜨거나 진짜 스폰이 막힌다. 프리뷰는 **비기너 온보딩 표면이 읽는 뷰모델만**
 * 갈아끼운다(`hooks/useOnboardingSetup`). 실 프로브·설치 IPC·PTY 스폰·키체인·
 * firestore 는 한 번도 호출되지 않는다.
 *
 * 이 파일은 그 시뮬레이션의 **순수 규칙**이다: 국면(stage) 하나에서 화면이 읽는
 * 모든 값(프로브 결과·준비 여부·샘플 상태·터미널 대본)이 파생된다. 부수효과(타이머)
 * 는 `stores/onboardingPreviewStore` 가 든다.
 */

/** 프리뷰 on/off 는 재시작을 넘겨 살아남는다(시연 도중 앱이 재시작돼도 이어짐). */
export const PREVIEW_ENABLED_KEY = "marblo.onboardingPreview.enabled";

/**
 * 프리뷰가 띄우는 "로그인 터미널" 의 세션 id 자리표시자. 실 PTY 세션이 아니므로
 * 이 값이 `TerminalView` 로 흘러가면 안 된다 — 화면은 `preview` 플래그를 보고
 * `PreviewTerminal`(대본 재생)을 대신 그린다.
 */
export const PREVIEW_SESSION_ID = "onboarding-preview";

/**
 * 시뮬 국면. 실제 흐름의 국면(`oneClickSetup.OneClickPhase`)과 **일부러** 이름을
 * 맞췄다 — 프리뷰는 새 흐름을 발명하는 게 아니라 같은 흐름을 재생하는 것이다.
 *
 *   connect        아무것도 안 깔린 첫 화면(연결 게이트)
 *   installing     "모두 설치" 진행 중
 *   sign_in        설치 끝 — 자동 사인인이 곧 시작된다
 *   awaiting_auth  로그인 터미널이 떠 있고 브라우저 승인 대기(시뮬)
 *   sample         인증 성립 → 샘플 폴더 자동 연결 중
 *   done           시뮬 종료. ★이 국면부터는 **실제 상태로 흘려보낸다** —
 *                  시연이 끝나면 사용자는 자기 진짜 워크스페이스에 착지해야 한다.
 */
export type PreviewStage =
  | "connect"
  | "installing"
  | "sign_in"
  | "awaiting_auth"
  | "sample"
  | "done";

export const PREVIEW_STAGES: PreviewStage[] = [
  "connect",
  "installing",
  "sign_in",
  "awaiting_auth",
  "sample",
  "done",
];

/** "다음 단계" — 시연자가 대기 시간을 건너뛸 때. `done` 에서는 더 갈 곳이 없다. */
export function nextPreviewStage(stage: PreviewStage): PreviewStage {
  const i = PREVIEW_STAGES.indexOf(stage);
  return i < 0 || i >= PREVIEW_STAGES.length - 1
    ? "done"
    : PREVIEW_STAGES[i + 1];
}

/**
 * 프리뷰가 게이트 값을 가로채는가.
 *
 * ★`done` 이 패스스루인 것이 이 모드의 안전장치다: 시뮬이 끝나면 화면은 즉시
 * 진짜 `cliSetupStore.ready` / 진짜 프로젝트를 읽는다. 토글을 끄는 걸 잊어도
 * 사용자가 자기 워크스페이스에서 잠기지 않는다.
 */
export function previewOverridesGate(
  enabled: boolean,
  stage: PreviewStage,
): boolean {
  return enabled && stage !== "done";
}

/** 시뮬 상의 CLI 준비 여부 — 셸의 연결 게이트 통과 판정. */
export function previewCliReady(stage: PreviewStage): boolean {
  return stage === "sample" || stage === "done";
}

/** 시뮬 상의 샘플 폴더 자동연결 상태(#872 의 "준비 중" 표면을 그대로 재생). */
export function previewSampleStatus(stage: PreviewStage): FirstRunSampleStatus {
  if (stage === "sample") return "preparing";
  if (stage === "done") return "connected";
  return "idle";
}

/**
 * 시뮬 프로브 결과 — 실 프로브(`harness.cliAuthCheck`)를 **부르지 않는다**.
 *
 * `oneClickRowIds` 는 "모두 설치" 가 실제로 대상으로 삼는 행(오케 후보)이다.
 * 그 밖의 행(grok·antigravity)은 설치 대상이 아니므로 시뮬에서도 끝까지 미설치로
 * 남는다 — 원클릭이 고르지도 않은 벤더를 깔지 않는다는 규칙을 화면에서도 그대로
 * 보여줘야 시연이 진실을 말한다.
 */
export function previewResults(
  rowIds: string[],
  oneClickRowIds: string[],
  stage: PreviewStage,
): Record<string, CliProbeLike> {
  const installedByStage =
    stage === "sign_in" ||
    stage === "awaiting_auth" ||
    stage === "sample" ||
    stage === "done";
  const authedByStage = stage === "sample" || stage === "done";
  const out: Record<string, CliProbeLike> = {};
  for (const id of rowIds) {
    const target = oneClickRowIds.includes(id);
    out[id] = {
      installed: target && installedByStage,
      authenticated: target && authedByStage,
    };
  }
  return out;
}

/** 시뮬 일괄설치 진행률. 국면이 아니라 진행 카운터에서 파생한다. */
export function previewBulk(
  stage: PreviewStage,
  total: number,
  done: number,
): BulkInstallProgress | null {
  if (stage === "connect") return null;
  return {
    running: stage === "installing",
    total,
    done: stage === "installing" ? Math.min(done, total) : total,
    // 프리뷰는 실패를 만들지 않는다 — 실패 경로(수동 명령·공식문서)는 이미 실
    // 화면에서 검증됐고, 여기서 가짜 실패를 그리면 시연이 거짓말을 한다.
    failedIds: [],
  };
}

/**
 * 로그인 터미널 **대본**. 실 PTY 를 띄우지 않으므로 CLI 가 인쇄할 법한 줄을
 * 우리가 재생한다.
 *
 * ★모든 대본에 "프리뷰" 표식을 박는다. 이 화면은 진짜 로그인 터미널과 픽셀 단위로
 * 닮아야 시연이 되지만, 스크린샷만 보고 "실제로 로그인됐다" 고 오해하면 안 된다 —
 * 특히 이 모드는 이미 인증된 유저의 기계에서 돌아간다.
 */
export function previewLoginTranscript(model: CliModel): string[] {
  const bin = model === "antigravity" ? "agy" : model;
  const cmd = model === "antigravity" ? "agy" : `${bin} login`;
  return [
    `$ ${cmd}`,
    "",
    "  [preview] 시뮬레이션입니다 — 실제 로그인은 일어나지 않습니다.",
    "",
    "Opening your browser to complete sign-in…",
    `  https://example.invalid/oauth/authorize?client_id=${bin}-preview`,
    "",
    "Waiting for approval in the browser…",
    "✓ Signed in (preview)",
    "",
  ];
}

/**
 * 프리뷰에서 **로그인 큐가 고를 CLI 후보** — 실 흐름의 `signInRows` 와 같은
 * 규칙(설치됨 + 미인증, 행 순서 = 오케 후보 우선)을 프리뷰 결과에 적용한 것이라,
 * 시연과 실물이 같은 CLI 를 고른다.
 *
 * ★구독 선택(티켓 LLHMclpKaIAJbsiHzGoG)이 생긴 뒤로 **자동 선택은 없다**: 무엇에
 * 로그인할지는 사용자가 고르고, 시연도 같은 화면을 그대로 지난다. 이 함수는 그
 * 규칙이 프리뷰 결과에서도 성립하는지 확인하는 판정으로 남는다.
 */
export function previewSignInModel<R extends { id: string; model: CliModel }>(
  rows: R[],
  results: Record<string, CliProbeLike | undefined>,
): CliModel | null {
  const hit = rows.find((r) => {
    const s = results[r.id];
    return s?.installed === true && s.authenticated !== true;
  });
  return hit ? hit.model : null;
}
