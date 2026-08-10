/**
 * 워커 부트 프리픽스 다이어트 — on/off 정책 단일 소스.
 *
 * 배경 (`v3/docs/token-efficiency-levers-2026-08-09.md`, #900):
 *   Claude 워커는 매 요청 최소 105.7K 토큰(폴 기준)을 다시 읽고, 그 입력 비용의
 *   100%가 캐시 재전송이다. 재전송 증폭이 실측 50배라 **프리픽스 1토큰 = 세션당
 *   50토큰**이다. 그래서 "캐시를 더 잘 맞히기"가 아니라 "프리픽스를 더 작게"가
 *   남은 유일한 큰 레버다.
 *
 * 이 모듈은 그 다이어트의 세 노브를 한 곳에서 켜고 끈다. 전부 **워커 전용**이며
 * 오케스트레이터 세션은 어떤 노브도 건드리지 않는다(판단 근거를 깎으면 안 된다).
 *
 *   A1  역할별 MCP `tools/list` 스코핑   (MCP 서버가 `MARBLO_AGENT_ROLE` 로 판단)
 *   A2  워커 세션 auto-memory 주입 차단  (`--settings {"autoMemoryEnabled":false}`)
 *   A3  워커 세션 스킬 목록 주입 차단    (`--disable-slash-commands`) — ★기본 OFF
 *
 * ★A3 가 왜 기본 OFF 인가. 실측 절감은 11.8K 토큰으로 셋 중 두 번째로 크지만,
 *   유일하게 **되돌리기 전까지 조용한** 능력 손실을 낼 수 있는 노브다: 워커가
 *   슬래시 스킬(/browse·/investigate·superpowers TDD 등)을 지시받았을 때 그
 *   스킬이 아예 존재하지 않게 된다. A1+A2 만으로 이미 #900 의 목표 감축률을
 *   넘기므로(문서 §측정), A3 는 A1·A2 가 프로덕션에서 무회귀 확인된 뒤
 *   `MARBLO_WORKER_SKILLS=off` 로 켜는 2단계로 남긴다.
 *
 * ★롤백: `MARBLO_PREFIX_DIET=off` 하나면 모든 노브가 꺼지고 스폰 argv/env 가
 *   다이어트 이전과 바이트 동등해진다. 노브별로도 끌 수 있다(아래 env 표).
 *   앱 재시작이면 반영된다 — 배포된 빌드를 되돌릴 필요가 없다.
 *
 *   | env                        | 값          | 효과                          |
 *   | -------------------------- | ----------- | ----------------------------- |
 *   | `MARBLO_PREFIX_DIET`       | off/0/false | 전부 끄기(전면 롤백)          |
 *   | `MARBLO_TOOL_SURFACE`      | full        | A1 만 끄기                    |
 *   | `MARBLO_WORKER_AUTOMEMORY` | on/1        | A2 만 끄기(메모리 다시 주입)  |
 *   | `MARBLO_WORKER_SKILLS`     | off/0       | A3 **켜기**(스킬 목록 제거)   |
 *
 * 측정치(2026-08-10, 실측 하네스는 `v3/docs/boot-prefix-diet-2026-08-10.md`)는
 * 문서에 있다. 여기 숫자를 중복해 적지 않는다 — 드리프트하면 거짓말이 된다.
 */

type DietEnv = Record<string, string | undefined>;

function isOff(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "off" || v === "0" || v === "false" || v === "no";
}

function isOn(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "on" || v === "1" || v === "true" || v === "yes";
}

/** 다이어트 전체 스위치. 기본 ON — 끄려면 `MARBLO_PREFIX_DIET=off`. */
export function prefixDietEnabled(env: DietEnv = process.env): boolean {
  return !isOff(env.MARBLO_PREFIX_DIET);
}

/**
 * 다이어트를 적용할 역할인가.
 *
 * 오케스트레이터/리더는 제외한다. 오케는 보드 전체를 보고 판단하는 주체라
 * 툴·메모리·스킬 어느 것도 깎으면 안 된다(#900 §4.1 리스크 항목).
 */
export function isDietableWorkerRole(role: string | undefined): boolean {
  const r = (role || "").trim().toLowerCase();
  if (!r) return false; // 역할 미상 → fail-open(종전 동작 유지)
  return r !== "orchestrator" && r !== "team_leader" && r !== "teamleader";
}

/** A2 — 워커 claude 세션에서 auto-memory 주입을 끌 것인가. */
export function shouldDisableWorkerAutoMemory(
  role: string | undefined,
  env: DietEnv = process.env,
): boolean {
  if (!prefixDietEnabled(env)) return false;
  if (isOn(env.MARBLO_WORKER_AUTOMEMORY)) return false;
  return isDietableWorkerRole(role);
}

/**
 * A3 — 워커 claude 세션에서 스킬(슬래시 커맨드) 목록 주입을 끌 것인가.
 *
 * ★기본 OFF(=스킬 유지). 조용한 능력 손실 위험이 셋 중 유일하게 실재해서,
 * 명시적으로 `MARBLO_WORKER_SKILLS=off` 를 켠 경우에만 적용한다.
 */
export function shouldDisableWorkerSkills(
  role: string | undefined,
  env: DietEnv = process.env,
): boolean {
  if (!prefixDietEnabled(env)) return false;
  if (!isOff(env.MARBLO_WORKER_SKILLS)) return false;
  return isDietableWorkerRole(role);
}

/**
 * A1 — MCP 서버 프로세스에 넘길 다이어트 env.
 *
 * `MARBLO_AGENT_ROLE` 은 MCP 서버가 표면을 정하는 유일한 입력이다(정책 본문은
 * `mcp-server/tool-surface.ts`). 역할이 비었거나 다이어트가 꺼져 있으면 **아무
 * 것도 넣지 않는다** — MCP 쪽 기본값이 전체 노출이라 그게 곧 종전 동작이다.
 */
export function toolSurfaceEnv(
  role: string | undefined,
  env: DietEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  // 명시 override 는 다이어트 on/off 와 무관하게 항상 전달한다(강제 full/scoped).
  if (env.MARBLO_TOOL_SURFACE) {
    out.MARBLO_TOOL_SURFACE = env.MARBLO_TOOL_SURFACE;
  } else if (!prefixDietEnabled(env)) {
    out.MARBLO_TOOL_SURFACE = "full";
  }
  const r = (role || "").trim().toLowerCase();
  if (r) out.MARBLO_AGENT_ROLE = r;
  return out;
}

/**
 * 워커 claude 세션의 `--settings` JSON. 기존 값(enabledPlugins 등) 위에 다이어트
 * 키를 **머지**한다.
 *
 * ★`--settings` 는 단일 값 옵션이라 두 번 넘기면 마지막 것만 살아남는다. 그래서
 *   따로 붙이지 않고 반드시 한 객체로 합친다 — 이걸 놓치면 텔레그램 플러그인
 *   차단(pyp7odpPQ6emCWLmUrBz)이 조용히 풀린다.
 */
export function workerClaudeSettings(
  base: Record<string, unknown>,
  role: string | undefined,
  env: DietEnv = process.env,
): Record<string, unknown> {
  if (!shouldDisableWorkerAutoMemory(role, env)) return base;
  return { ...base, autoMemoryEnabled: false };
}
