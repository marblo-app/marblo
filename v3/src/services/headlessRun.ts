/**
 * 연결된 CLI 를 **헤드리스로 딱 한 번** 돌리고 원문을 받아 오는 러너.
 *
 * 코드탭 퀵액션(`useCodeQuickAction`)이 쓰던 구현을 그대로 끌어낸 것이다. 두 번째
 * 소비자(온보딩의 구독/크레딧 프로브)가 생겼는데, 이 함수의 값어치는 로직이
 * 아니라 **정리 순서**에 있다 — 리스너를 걷고, `pty:replay` 로 갇힌 첫 바이트를
 * 꺼내고, 어떻게 끝나든 세션을 죽인다. 그걸 두 벌 두면 한쪽만 fd 를 흘린다
 * (PTY 마스터 fd 누수는 이 repo 에서 이미 한 번 터진 적이 있다).
 *
 * 새 IPC 는 없다: 기존 `pty:*` 채널만 쓰므로 메인 프로세스는 한 줄도 안 바뀐다.
 */

export interface HeadlessRunHandle {
  ptyId: string;
  cancelled: boolean;
}

export interface HeadlessRunResult {
  raw: string;
  exitCode: number | null;
  /** 상한 시간을 넘겨 우리가 끊었는가 — 호출부가 "실패" 와 구분해야 한다. */
  timedOut: boolean;
}

export interface HeadlessRunOptions {
  command: string;
  args: string[];
  /** 없으면 메인 프로세스의 기본 cwd 를 쓴다. */
  cwd?: string;
  timeoutMs: number;
  handle: HeadlessRunHandle;
  /** 터미널 목록에 뜨는 이름. */
  name?: string;
}

/**
 * PTY 1회 실행 → 원시 출력. 종료·타임아웃·취소 중 무엇으로 끝나든 리스너를
 * 걷고 세션을 정리한다(fd 를 남기지 않는다).
 */
export async function runHeadlessOnce(
  opts: HeadlessRunOptions,
): Promise<HeadlessRunResult> {
  const { command, args, cwd, timeoutMs, handle } = opts;
  const { pty } = window.electronAPI;
  const id = handle.ptyId;

  await pty.create({
    id,
    name: opts.name ?? `Headless ${id}`,
    command,
    args,
    cwd,
  });

  let raw = "";
  let exitCode: number | null = null;
  let timedOut = false;
  let settle: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const finish = () => {
    settle?.();
    settle = null;
  };

  pty.onData(id, (chunk) => {
    raw += chunk;
  });
  pty.onExit(id, (code) => {
    exitCode = code;
    finish();
  });

  // main 은 `pty:replay` 가 불릴 때까지 초기 출력을 버퍼에 잡아 둔다. 이걸
  // 안 부르면 CLI 가 뱉은 첫 바이트들이 메인 프로세스에 갇힌 채 영영 안 온다.
  const buffered = await pty.replay(id);
  raw = buffered.join("") + raw;

  const timer = window.setTimeout(() => {
    timedOut = true;
    finish();
  }, timeoutMs);
  // 안전망: 리스너를 달기 전에 프로세스가 끝나 exit 이벤트를 놓쳤더라도
  // 여기서 죽은 세션을 알아채고 빠져나온다(무한 대기 방지).
  const liveness = window.setInterval(() => {
    if (handle.cancelled) return finish();
    void pty
      .exists(id)
      .then((alive) => {
        if (!alive) finish();
      })
      .catch(() => finish());
  }, 2000);

  try {
    await finished;
  } finally {
    window.clearTimeout(timer);
    window.clearInterval(liveness);
    try {
      await pty.kill(id);
    } catch {
      // 이미 죽은 세션 — kill 실패는 정상 경로다.
    }
    pty.removeListeners(id);
  }

  return { raw, exitCode, timedOut };
}
