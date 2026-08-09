import {
  PROBE_TIMEOUT_MS,
  classifyFundingProbe,
  probeArgs,
  type FundingProbeOutcome,
} from "../lib/fundingProbe";
import type { CliModel } from "../stores/cliSetupStore";
import { runHeadlessOnce } from "./headlessRun";

/**
 * ★"로그인은 됐는데 진짜 한 턴이 도는가" 를 **실측**하는 부수효과.
 *
 * 판정은 전부 `lib/fundingProbe` 의 순수 함수가 하고, 여기 남는 것은 배선뿐이다:
 * 어떤 바이너리를 어떤 인자로 돌릴지 고르고, 기존 `pty:*` 채널로 한 번 돌리고,
 * 원문을 판정기에 넘긴다. 메인 프로세스는 한 줄도 안 바뀐다(코드탭 퀵액션이
 * 이미 쓰던 경로 그대로다).
 *
 * ★이 프로브는 **실제 모델 턴을 한 번 태운다**(짧지만 공짜는 아니다). 그래서
 * 호출 시점이 좁게 묶여 있다 — 인증이 방금 이 세션에서 성립했을 때 한 번,
 * 그리고 사용자가 가이드 모달에서 "다시 확인" 을 눌렀을 때. 매 재시작마다 도는
 * 일은 없어야 한다(`cliSetupStore.runFundingProbe` 의 setupInitiated 게이트).
 */

let probeSeq = 0;

/**
 * 프로브를 돌릴 CLI 의 실행 파일. claude 는 설치 경로가 기계마다 달라서 메인이
 * 해석해 준 값을 쓴다(퀵액션과 같은 규칙) — 실패하면 PATH 의 `claude` 로 떨어진다.
 */
async function resolveCommand(model: CliModel): Promise<string> {
  if (model !== "claude") return model;
  try {
    return (await window.electronAPI.claude.version()).command || "claude";
  } catch {
    return "claude";
  }
}

/**
 * `model` 을 헤드리스로 한 번 돌린 판정. 지원하지 않는 CLI(grok·antigravity)이면
 * null — 헤드리스 계약을 실측하지 못한 CLI 에 추측한 플래그를 던지면 프로브가
 * 실패로 떨어져 **정상 유저에게 경고를 띄우게 된다**.
 */
export async function probeFunding(
  model: CliModel,
): Promise<FundingProbeOutcome | null> {
  const args = probeArgs(model);
  if (!args) return null;

  const handle = {
    ptyId: `funding-probe-${++probeSeq}-${Math.random().toString(36).slice(2, 8)}`,
    cancelled: false,
  };

  // ★cwd 를 일부러 주지 않는다 — 메인 프로세스가 홈 디렉터리로 떨어뜨린다
  // (`ptyManager.create`: `cwd || os.homedir()`). 사용자의 프로젝트 폴더에서
  // 돌리면 그 폴더의 CLAUDE.md·설정이 프로브 턴에 딸려 들어가 느려지는데, 우리가
  // 묻는 것은 "이 계정이 도는가" 이지 "이 저장소에서 도는가" 가 아니다. 덤으로
  // 이 모듈이 projectStore(→firestore)를 끌고 오지 않는다 — 스토어를 쓰는 유닛
  // 테스트가 통째로 firebase 초기화에 걸리던 경로다.
  try {
    const command = await resolveCommand(model);
    const { raw, exitCode, timedOut } = await runHeadlessOnce({
      command,
      args,
      timeoutMs: PROBE_TIMEOUT_MS,
      name: `Funding probe ${model}`,
      handle,
    });
    return classifyFundingProbe({ model, raw, exitCode, timedOut });
  } catch {
    // 스폰 자체가 실패했다 — 실행 가능 여부에 대해 아무것도 배우지 못했다.
    // `inconclusive` 는 화면에 아무것도 띄우지 않는다.
    return classifyFundingProbe({
      model,
      raw: "",
      exitCode: null,
      spawnFailed: true,
    });
  }
}
