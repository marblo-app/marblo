import type { CliProbeLike, SetupRowLike } from "./oneClickSetup";
import type { CliModel } from "../stores/cliSetupStore";

/**
 * 자동설치 **다음 칸**의 순수 판정 — "어떤 구독 가지고 계세요?" → CLI 별 로그인
 * (티켓 LLHMclpKaIAJbsiHzGoG).
 *
 * ★고치는 실패모드: 콜드테스트에서 자동설치는 잘 끝나는데 그 뒤 **로그인 유도가
 * 없었다.** 이미 CLI 로그인이 돼 있는 기계에서는 설치가 끝나는 순간 `ready` 가
 * 서서 흐름이 그대로 이어졌지만, 진짜 신규 유저(로그인 안 된)는 여기서 멈춘다 —
 * 원클릭 모달이 오케 후보 **하나**의 로그인만 띄우고, 그 하나가 그 유저가 가진
 * 구독이 아니면 승인할 수 있는 게 없었다. 활성화 퍼널에서 가장 큰 이탈 지점이다.
 *
 * 그래서 이 파일이 드는 것은 세 판정이다:
 *   - 무엇을 물을 것인가            `SUBSCRIPTION_CHOICES`
 *   - 무엇에 로그인시킬 것인가      `pendingLoginModels` / `nextLoginTarget`
 *   - 무엇을 기본 오케로 삼을 것인가 `defaultOrchestratorModel`
 *
 * 전부 프로브 결과(`cliSetupStore.results`)에 대한 순수 함수다. 새 상태를 만들지
 * 않는 게 중요하다 — "이미 로그인됐나" 의 판정이 두 벌이 되면 한쪽만 낡아서
 * **이미 로그인한 사용자에게 로그인 터미널을 다시 띄우는** 회귀가 생긴다.
 */

/**
 * 물어볼 구독. 순서가 곧 화면 순서이자 기본 오케의 우선순위다.
 *
 * ★antigravity 는 여기 없다. 이 화면의 질문은 "어떤 **구독**을 가지고 계세요?"
 * 인데 agy 는 구독이 아니라 구글 계정으로 붙고(별도 `login` 서브커맨드도 없다),
 * 비기너에게 보여줄 선택지는 적을수록 좋다. 어드밴스드의 시작하기 탭에서 계속
 * 지원된다.
 */
export const SUBSCRIPTION_CHOICES: readonly CliModel[] = [
  "claude",
  "codex",
  "grok",
];

function rowFor<R extends SetupRowLike>(
  rows: R[],
  model: CliModel
): R | undefined {
  return rows.find((r) => r.model === model);
}

/**
 * 이 CLI 가 **이미 로그인돼 있는가**. 판정원은 기존 설치/인증 프로브 하나뿐이다
 * (`harness:cliAuthCheck` → `cliSetupStore.results`) — 이 화면을 위한 새 감지
 * 로직은 없다.
 */
export function isSignedIn<R extends SetupRowLike>(
  rows: R[],
  results: Record<string, CliProbeLike | undefined>,
  model: CliModel
): boolean {
  const row = rowFor(rows, model);
  return !!row && results[row.id]?.authenticated === true;
}

/**
 * 이 CLI 가 아직 안 깔렸다고 **프로브가 명시적으로 말했는가**.
 *
 * 결과가 없는 행(아직 안 봤다)은 false 다 — `pendingInstallRows` 와 같은 규칙이다.
 * "아직 모른다" 가 "설치해라" 가 되면 느린 프로브 한 번이 멀쩡한 CLI 위로 셸
 * 인스톨러를 다시 돌린다.
 */
export function needsInstall<R extends SetupRowLike>(
  rows: R[],
  results: Record<string, CliProbeLike | undefined>,
  model: CliModel
): boolean {
  const row = rowFor(rows, model);
  return !!row && results[row.id]?.installed === false;
}

/**
 * 고른 것 중 **실제로 로그인 터미널을 띄워야 하는** CLI 들, 고른 순서 그대로.
 *
 * ★이미 인증된 것은 여기서 빠진다. 이게 "이미 로그인된 CLI 는 자동감지해
 * 건너뛰기" 의 전부다 — 화면이 따로 판정하지 않는다. 사장님처럼 전부 로그인돼
 * 있는 기계에서는 이 배열이 **빈다**(= 띄울 터미널이 하나도 없다).
 *
 * 안 깔린 CLI 는 남는다: 설치는 로그인 직전에 하면 되고(그록은 자동설치 대상이
 * 아니라 여기서만 깔린다), "구독은 있는데 CLI 가 없다" 는 건너뛸 이유가 아니다.
 */
export function pendingLoginModels<R extends SetupRowLike>(
  rows: R[],
  picked: readonly CliModel[],
  results: Record<string, CliProbeLike | undefined>
): CliModel[] {
  const seen = new Set<CliModel>();
  return picked.filter((model) => {
    if (seen.has(model)) return false; // 같은 CLI 를 두 번 띄우지 않는다
    seen.add(model);
    if (!rowFor(rows, model)) return false; // 우리가 모르는 CLI 는 대상이 아니다
    return !isSignedIn(rows, results, model);
  });
}

/**
 * 지금 로그인 터미널을 띄울 대상 하나. 한 번에 **하나**인 것이 이 큐의 계약이다.
 *
 * 동시에 셋을 띄우면 브라우저 승인 탭이 셋 열리고 어느 터미널이 무엇을 기다리는지
 * 알 수 없다(`cliSetupActions.oneClickSignIn` 이 원래 하나만 띄우던 이유). 대신
 * 앞의 것이 인증되면 `pendingLoginModels` 에서 빠지므로 다음 대상이 스스로
 * 올라온다 — 큐가 저절로 굴러간다.
 *
 * `skipped` 는 사용자가 "이건 건너뛸게요" 를 누른 것들이다. 인증되지 않았는데도
 * 큐에서 빼야 하는 유일한 경우라 판정에 함께 들어온다.
 */
export function nextLoginTarget<R extends SetupRowLike>(
  rows: R[],
  picked: readonly CliModel[],
  results: Record<string, CliProbeLike | undefined>,
  skipped: readonly CliModel[] = []
): CliModel | null {
  return (
    pendingLoginModels(rows, picked, results).find(
      (model) => !skipped.includes(model)
    ) ?? null
  );
}

/**
 * 기본 오케로 삼을 CLI — 연결·인증된 것 중 제품 우선순위.
 *
 * 우선순위는 **Claude > Codex > Grok** (`SUBSCRIPTION_CHOICES` 순서와 같다).
 * 고른 것 중 이미 인증된 것만 후보로 두고, 그 안에서 이 순서로 고른다. 여러
 * 네이티브가 동시에 붙어 있을 때 그록이 먼저 잡히던 실패모드를 막는다
 * (mwYD1YxEc9aARgmZ4bX7). 인증된 게 하나도 없으면 고른 것 중 같은 우선순위의
 * 첫 칸 — 로그인 큐의 1번이기도 하다.
 *
 * "이미 인증된 것 우선" 규율은 유지한다: 아직 로그인 중인 칸을 기본값으로 박으면
 * 첫 스폰이 곧장 인증 벽(#932 `needs_auth`)에 부딪힌다. 우선순위는 그 안에서만
 * 적용한다.
 *
 * 반환값은 그대로 `orchestratorModel.set` 의 하네스 값이다(claude/codex/grok 셋 다
 * 이미 오케 후보다 — main 의 `normalizeOrchestratorModelSetting` 이 받는 값들이라
 * 렌더러에서 문자열을 새로 만들지 않는다).
 */
export function defaultOrchestratorModel<R extends SetupRowLike>(
  rows: R[],
  picked: readonly CliModel[],
  results: Record<string, CliProbeLike | undefined>
): CliModel | null {
  if (picked.length === 0) return null;
  const pickedSet = new Set(picked);
  // 제품 우선순위 순회 — pick 배열 순서가 뒤집혀 있어도 Claude 가 이긴다.
  for (const model of SUBSCRIPTION_CHOICES) {
    if (pickedSet.has(model) && isSignedIn(rows, results, model)) {
      return model;
    }
  }
  for (const model of SUBSCRIPTION_CHOICES) {
    if (pickedSet.has(model)) return model;
  }
  return picked[0] ?? null;
}

/**
 * 구독 선택 화면의 기본 체크 상태.
 *
 * 이미 로그인된 CLI 는 **미리 체크해 둔다** — 그 구독을 가지고 있다는 건 이미
 * 증명된 사실이고, 체크를 풀게 만들면 "가진 걸 가졌다고 말하는" 클릭을 시키는
 * 셈이다. 나머지는 비워 둔다: 안 가진 구독을 기본 체크로 밀면 있지도 않은
 * 계정의 로그인 터미널이 뜬다.
 */
export function initialSubscriptionPick<R extends SetupRowLike>(
  rows: R[],
  results: Record<string, CliProbeLike | undefined>,
  choices: readonly CliModel[] = SUBSCRIPTION_CHOICES
): CliModel[] {
  return choices.filter((model) => isSignedIn(rows, results, model));
}
