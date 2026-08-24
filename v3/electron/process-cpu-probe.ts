/**
 * 능동 프로브 (a) — 프로세스 레벨 생존확인. 티켓 DQYoyas3ESx33zXJOCOa.
 *
 * agent-stall-policy.ts 의 evaluateProbe 에 넣을 `ProcessProbeSample` 을 만든다.
 * PTY 에는 아무것도 쓰지 않는다 — OS 에게 묻기만 한다.
 *
 * ★신규 의존성 0(오케 확정 2026-08-23). `pidusage` 류를 붙이지 않는 이유:
 *   메인 프로세스 의존성은 패키징·서명·번들 크기까지 따라오는데, 이건 **관측
 *   편의**를 위한 것이지 판정에 필수인 축이 아니다. (b) 풀형 MCP 관측만으로도
 *   "응답함" 판정은 성립하고, 여기서 얻는 CPU 는 보조 증거일 뿐이다.
 *
 * ★그래서 이 모듈의 모든 실패는 조용히 null 이다 — "관측 불가" 는
 *   evaluateProbe 에서 '프로브 불가' 3분기로 떨어지고, board-quiet(20/45분)
 *   안전망이 그대로 받는다. 절대 '멈춤' 으로 뚝치지 않는다.
 */
import { execFile } from "child_process";

import type { ProcessProbeSample } from "./agent-stall-policy";

/** `ps` 한 번에 허용하는 시간(ms). 넘으면 관측 실패로 본다 — 워치독 sweep 을
 * 붙잡아 두느니 그냥 모른다고 하는 게 낫다. */
const PS_TIMEOUT_MS = 1_500;

/**
 * pid 가 살아 있는가. **확신할 때만** boolean 을 돌려준다.
 *
 * ESRCH(그런 프로세스 없음)일 때만 false. EPERM(다른 사용자 소유라 시그널을
 * 못 보냄)은 "존재하긴 한다" 는 뜻이므로 true, 그 밖의 오류·비정상 pid 는
 * null(모름)이다. pty-manager.ts 의 reaper 가 쓰는 것과 같은 관용구이고,
 * 거기서도 ESRCH 만 죽음으로 친다.
 */
export function probePidAlive(pid: number | null | undefined): boolean | null {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1)
    return null;
  try {
    process.kill(pid, 0); // 시그널 0 = 전달만 검사, 프로세스에 아무 영향 없음
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true; // 존재는 한다
    return null;
  }
}

/**
 * `ps -o time=` 의 누적 CPU 시간 문자열을 ms 로. 파싱 실패는 null.
 *
 * macOS/BSD 는 `MM:SS.ss`, 길어지면 `HH:MM:SS`, 더 길면 `DD-HH:MM:SS` 를 낸다.
 * 순수 함수로 뺀 이유는 이 포맷 분기가 테스트로 고정돼야 하기 때문이다 —
 * 조용히 NaN 이 되면 CPU 축이 있는 척하면서 아무 일도 안 하게 된다.
 */
export function parsePsCpuTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let days = 0;
  let rest = s;
  const dash = s.indexOf("-");
  if (dash > 0) {
    days = Number.parseInt(s.slice(0, dash), 10);
    if (!Number.isFinite(days)) return null;
    rest = s.slice(dash + 1);
  }
  const parts = rest.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => Number.parseFloat(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [h, m, sec] =
    nums.length === 3 ? nums : [0, nums[0] as number, nums[1] as number];
  return Math.round(
    ((days * 24 + (h as number)) * 3600 +
      (m as number) * 60 +
      (sec as number)) *
      1000,
  );
}

/**
 * pid 의 누적 CPU 시간(ms). 관측 불가면 null.
 *
 * ★macOS 전용(오케 확정: "플랫폼 분기를 늘리지 마라"). 다른 플랫폼은 즉시
 *   null 로 떨어져 '프로브 불가' 가 된다 — linux 의 /proc 파싱을 얹으면
 *   플랫폼별로 다른 실패모드를 하나 더 떠안게 되는데, 이 값은 애초에 보조
 *   증거라 그 비용을 낼 이유가 없다.
 */
export function sampleProcessCpuMs(
  pid: number | null | undefined,
): Promise<number | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      execFile(
        "/bin/ps",
        ["-o", "time=", "-p", String(pid)],
        { timeout: PS_TIMEOUT_MS },
        (err, stdout) => {
          if (err) return resolve(null);
          resolve(parsePsCpuTime(String(stdout)));
        },
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * evaluateProbe 에 넘길 표본 하나. `prevCpuMs` 는 호출자가 직전 sweep 의
 * 표본을 들고 있다가 넣는다(CPU 는 델타로만 의미가 있고, 첫 표본은 델타를
 * 못 내므로 그 라운드는 CPU 축 없이 판정된다).
 *
 * ★의심스러울 때만 부른다 — 상시 폴링 금지. 호출부(agent-watchdog sweepQuiet)
 *   는 다른 축이 티켓을 가져가지 않았고 보드도 MCP 도 유예를 넘긴 뒤에만 여기
 *   들어온다.
 */
export async function sampleProcessProbe(
  pid: number | null | undefined,
  prevCpuMs: number | null,
): Promise<ProcessProbeSample> {
  const alive = probePidAlive(pid);
  // pid 가 확정적으로 없으면 ps 를 부를 이유가 없다.
  const cpuMs = alive === false ? null : await sampleProcessCpuMs(pid);
  return { alive, cpuMs, prevCpuMs };
}
