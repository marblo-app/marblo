/**
 * 오케가 **멈춘 사유** 를 화면 지시로 바꾸는 순수 규칙.
 *
 * ── 무엇이 틀려 있었나 (실측 F-4/F-5, 티켓 ymRo9BtilQnb48Y5ol68) ──────────
 * `setStatus("error")` → `orchestrator:statusChanged` 는 `{status}` 만 실었고,
 * 보드 렌더러엔 그 채널 **구독자가 0** 이었다. 패널의 점·라벨은 렌더러 로컬
 * 스토어만 읽으므로 launch 가 성공 반환한 뒤로는 **초록 running 에 고정**됐다.
 * 사유("codex needs auth" / "a first-run dialog is on screen")는 main 의
 * `console.error` 에만 있었다. 유일한 `role="alert"` 배너는 launch 가 동기로 주는
 * `result.needsAuth`(스폰 **전** 게이트) 로만 켜지는데, 로그인 백스톱은 PTY 가 뜬
 * **뒤에** 발화하므로 그 배너에 영영 못 닿는다.
 *
 * ★비기너가 더 나빴다. 별도 런치 경로 없이 같은 IPC·같은 `OrchestratorPanel` 을
 * 쓰고 터미널까지 렌더되므로, **멈춘 다이얼로그가 원시 PTY 로 보이는데 그 위엔
 * 초록 "실행 중"** 이 달려 있었다. 무엇을 해야 하는지 알 길이 전혀 없었다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 * ① 사유는 **분류값만** 다룬다. main 이 보낸 문자열이 우리가 아는 값이 아니면
 *    화면에 **그리지 않고** `"unknown"` 으로 접는다. 이 한 줄이 PTY 원문 유출을
 *    구조적으로 막는다 — 미래에 누가 main 에서 원문을 실어 보내도 이 경계를
 *    통과하지 못한다(그 회귀를 `tests/unit/orchestrator-halt.test.ts` 가 못박는다).
 * ② 문구는 **다음 행동까지** 적는다. "오류" 한 줄은 사장님이 오늘 아침 겪으신
 *    "설명 없이 멈춘 화면" 과 정보량이 같다. 그래서 각 사유는 title(무슨 일이
 *    났나) + hint(무엇을 하면 되나) 두 키를 반드시 가진다.
 * ③ 이 파일은 `electron/` 을 import 하지 않는다(repo 경계 규약 —
 *    `src/lib/rootPathScope.ts`). 그래서 사유 문자열은 **미러**이고, 벌어지면
 *    테스트가 깨진다.
 */
import {
  LOGIN_CTA_MODELS,
  type OrchestratorBlockLoginModel,
} from "./orchestratorLaunchBlock";

/**
 * main 의 `OrchestratorHaltReason` 미러(`electron/orchestrator-manager.ts`).
 * 순서까지 같게 둔다 — 테스트가 원소단위로 대조한다.
 */
export const ORCHESTRATOR_HALT_REASONS = [
  "needsAuth",
  "firstRunDialog",
  "rootPathMissing",
  "spawnFailed",
  "crashLoop",
] as const;

export type OrchestratorHaltReason = typeof ORCHESTRATOR_HALT_REASONS[number];

/** main의 허용 errno 분류(`electron/orchestrator-manager.ts`) 미러. */
export const ORCHESTRATOR_SPAWN_ERRNOS = ["EACCES", "ENXIO"] as const;
export type OrchestratorSpawnErrno = typeof ORCHESTRATOR_SPAWN_ERRNOS[number];

/**
 * 우리가 모르는 사유가 왔을 때 접히는 자리.
 *
 * ★"모르는 문자열은 그냥 보여주자" 가 아니다. 그러면 구버전/신버전 main 이
 * 뒤섞이는 패키지 앱에서 화면이 무엇을 그릴지 아무도 보장할 수 없고, PTY 발췌가
 * 실려 오는 날 그대로 화면에 뜬다. 모르면 "멈췄다 + 다시 시작하세요" 라는 참인
 * 최소 정보만 말한다.
 */
export type OrchestratorHaltKind = OrchestratorHaltReason | "unknown";

export interface OrchestratorHalt {
  kind: OrchestratorHaltKind;
  /** 멈춘 하네스의 CLI id. 모르면 null — 문구가 이름 없이도 성립한다. */
  model: string | null;
  /** `spawnFailed` 배너의 안내를 고르는, 검증된 errno 분류. */
  spawnErrno?: OrchestratorSpawnErrno;
}

/** statusChanged 봉투(모양만. 필드 추가에 관대하다). */
export interface OrchestratorStatusEvent {
  status: string;
  reason?: string;
  spawnErrno?: string;
  model?: string;
}

const KNOWN_REASONS: ReadonlySet<string> = new Set(ORCHESTRATOR_HALT_REASONS);

/**
 * 하네스 이름을 문구에 넣어도 되는 값 목록.
 *
 * ★main 이 준 문자열을 그대로 화면에 흘리지 않기 위한 두 번째 관문이다. 사유는
 * 유니온이라 안전하지만 `model` 은 문자열 축이라, 여기서 아는 값으로 좁히지
 * 않으면 "무엇이든 화면에 찍히는 필드" 가 하나 생긴다.
 *
 * 스폰 전 차단이 쓰는 목록을 **그대로 재사용**한다(복사하지 않는다) — 두 축이
 * 같은 CLI 집합을 말하는데 목록이 둘이면, 하네스가 하나 늘 때 한쪽만 고쳐지고
 * 다른 쪽이 조용히 이름을 지워 버린다.
 */
const KNOWN_MODELS: readonly OrchestratorBlockLoginModel[] = LOGIN_CTA_MODELS;

/**
 * statusChanged 봉투 → 정지 사유. 멈춘 게 아니거나(=error 가 아니거나) 사유가
 * 안 왔으면 null.
 *
 * ★`status !== "error"` 에서 항상 null 인 것이 중요하다. 그래야 구독자가
 * "halt 가 null 이면 지금 멈춘 게 아니다" 로 읽어도 항상 옳고, 초록 상태 위에
 * 낡은 사유가 남는 반대 방향의 거짓말이 생기지 않는다.
 */
export function classifyOrchestratorHalt(
  event: OrchestratorStatusEvent
): OrchestratorHalt | null {
  if (event.status !== "error") return null;
  const kind: OrchestratorHaltKind =
    event.reason && KNOWN_REASONS.has(event.reason)
      ? (event.reason as OrchestratorHaltReason)
      : "unknown";
  const model =
    event.model &&
    (KNOWN_MODELS as readonly string[]).includes(event.model) &&
    event.model
      ? event.model
      : null;
  const spawnErrno =
    kind === "spawnFailed" &&
    event.spawnErrno &&
    (ORCHESTRATOR_SPAWN_ERRNOS as readonly string[]).includes(event.spawnErrno)
      ? (event.spawnErrno as OrchestratorSpawnErrno)
      : undefined;
  return { kind, model, ...(spawnErrno ? { spawnErrno } : {}) };
}

/**
 * 사유별 i18n 키. **title 과 hint 가 항상 쌍으로 있다** — hint 가 "무엇을 하면
 * 되나" 를 지는 자리라서, 하나라도 비면 이 티켓이 고치는 "사유는 있는데 다음
 * 행동이 없는 화면" 으로 되돌아간다. 테스트가 전 사유에 대해 두 키의 ko/en 존재를
 * 확인한다.
 */
export function orchestratorHaltCopyKeys(
  kind: OrchestratorHaltKind,
  spawnErrno?: OrchestratorSpawnErrno,
): {
  title: string;
  hint: string;
  /** 헤더 한 줄에 들어갈 짧은 라벨("Error" 를 대신한다). */
  label: string;
} {
  const spawnHintSuffix =
    kind === "spawnFailed" && spawnErrno
      ? spawnErrno === "EACCES"
        ? "Eacces"
        : "Enxio"
      : "";
  return {
    title: `orchestrator.halt.${kind}Title`,
    hint: `orchestrator.halt.${kind}${spawnHintSuffix}Hint`,
    label: `orchestrator.halt.${kind}Label`,
  };
}

/**
 * 배너에 원클릭 로그인 CTA 를 걸 CLI — 걸 수 없으면 null.
 *
 * 스폰 **전** 차단(`orchestratorBlockLoginModel`)과 조건이 다르다: 그쪽은
 * `installed` 를 알지만 이쪽은 이미 PTY 가 떠 있으므로 설치는 자명하다(안 깔린
 * 바이너리는 PTY 가 뜨지도 않는다). 남는 조건은 둘뿐이다 — 로그인으로 풀리는
 * 사유인가, 그리고 아는 CLI 인가.
 */
export function orchestratorHaltLoginModel(
  halt: OrchestratorHalt
): OrchestratorBlockLoginModel | null {
  if (halt.kind !== "needsAuth" || !halt.model) return null;
  return (KNOWN_MODELS.find((m) => m === halt.model) ??
    null) as OrchestratorBlockLoginModel | null;
}

/**
 * 이 사유로 멈춘 PTY 를 화면에 계속 보여줘야 하나.
 *
 * ★비기너에서 특히 중요하다. 첫 실행 다이얼로그는 **사용자가 그 터미널에서 직접
 * 답해야** 풀리는 화면이다. 상태가 error 로 바뀌었다고 터미널을 감추면, 고치라고
 * 안내해 놓고 고칠 도구를 뺏는 꼴이 된다(패널은 `isRunning` 일 때만 터미널을
 * 그렸으므로 이 함수가 없으면 정확히 그렇게 된다).
 * 반대로 폴더가 사라졌거나 크래시 루프면 그 PTY 는 이미 죽었으니 감춘다.
 */
export function orchestratorHaltKeepsTerminal(
  kind: OrchestratorHaltKind
): boolean {
  return kind === "needsAuth" || kind === "firstRunDialog";
}
