import { test, expect } from "../helpers/fixtures";

/**
 * 회귀: "모드를 바꾸면 오케 화면이 검게 뜬다" (티켓 BzxAJXxqhHgYzy1Aq4IV).
 *
 * 사장님 증상 — 마블로(어드밴스드) 모드에서는 오케가 잘 붙는데, 비기너 모드로
 * 넘어가면 검은 화면이다.
 *
 * 원인(이 스펙으로 실측): `App.tsx` 는 `<BeginnerShell/>` 과 `<WorkspaceShell/>`
 * 을 **형제 분기**로 그린다 — 모드를 바꾸면 서브트리째 언마운트되고 그 안의
 * OrchestratorPanel → TerminalView → xterm 이 통째로 새로 뜬다. 그런데 main 의
 * `ptyBuffers` 는 스크롤백이 아니라 **1회성 초기 버퍼**다: 첫 `pty:replay` 가
 * 드레인하면 `drainedSids` 에 기록되고 이후 출력은 라이브 전송만 된다. 그래서
 * 두 번째 마운트의 `pty:replay` 는 빈 배열을 받고, 새 출력이 올 때까지 화면에
 * 그릴 것이 아무것도 없다 = 검은 화면.
 *
 * 수정: 오케 PTY(`orch-*`)에 한해 드레인 후에도 유지되는 **재생 링**을 둔다.
 * 에이전트 PTY 는 종전 동작 그대로다(메모리 상한 근거는 main.ts 주석 참조).
 *
 * ★#1047(pty:resize 가 아직 드레인 안 된 버퍼를 비우던 문제)과는 다른 문제다.
 *   저건 버퍼가 '아직 있는' 경우, 이건 '이미 없는' 경우. 마지막 케이스가 #1047
 *   이 고친 동작이 살아 있는지 지킨다.
 */

const SETTLE_MS = 900;

test.describe("재마운트 PTY replay (모드 전환 경로)", () => {
  test("@unit 오케 PTY 는 드레인 뒤 재마운트해도 기존 출력을 돌려준다", async ({
    marblo,
  }) => {
    // 수정 전에는 두 번째 replay 가 [] 였다 = 새 출력이 올 때까지 검은 화면.
    const result = await marblo.page.evaluate(async (settleMs) => {
      // `orch-` 접두사 = 오케스트레이터 PTY (orchestrator-manager 의
      // `orch-${sessionId}-${Date.now()}` 와 같은 규칙).
      const id = `orch-remount-${Date.now()}`;
      await window.electronAPI.pty.create({
        id,
        name: "OrchRemount",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(id, 'printf "한글 첫 마운트 ALPHA\\r\\n"\r');
      await new Promise((r) => setTimeout(r, settleMs));

      // ① 마블로 모드의 첫 마운트 — 버퍼를 드레인한다.
      const first = await window.electronAPI.pty.replay(id);

      // ② 드레인 뒤에도 대화가 이어진다(라이브 전송 구간).
      window.electronAPI.pty.write(id, 'printf "한글 라이브 BRAVO\\r\\n"\r');
      await new Promise((r) => setTimeout(r, settleMs));

      // ③ 비기너 모드로 전환 = 새 TerminalView 가 다시 replay 한다.
      const second = await window.electronAPI.pty.replay(id);

      // ④ 다시 마블로 모드로 — 왔다갔다가 반복돼도 유지돼야 한다.
      window.electronAPI.pty.write(id, 'printf "한글 두번째 CHARLIE\\r\\n"\r');
      await new Promise((r) => setTimeout(r, settleMs));
      const third = await window.electronAPI.pty.replay(id);

      window.electronAPI.pty.kill(id);
      return {
        first: first.join(""),
        second: second.join(""),
        secondChunks: second.length,
        third: third.join(""),
        thirdChunks: third.length,
      };
    }, SETTLE_MS);

    expect(result.first).toContain("ALPHA");
    // 핵심 단언: 재마운트가 되돌려받을 게 있어야 한다.
    expect(result.secondChunks).toBeGreaterThan(0);
    expect(result.second).toContain("ALPHA");
    expect(result.second).toContain("BRAVO");
    // 전환을 여러 번 왔다갔다해도 링은 소모되지 않는다.
    expect(result.thirdChunks).toBeGreaterThan(0);
    expect(result.third).toContain("ALPHA");
    expect(result.third).toContain("BRAVO");
    expect(result.third).toContain("CHARLIE");
  });

  test("@unit 에이전트 PTY 는 종전대로 링을 남기지 않는다 (메모리 범위 고정)", async ({
    marblo,
  }) => {
    const result = await marblo.page.evaluate(async (settleMs) => {
      const id = `agent-remount-${Date.now()}`;
      await window.electronAPI.pty.create({
        id,
        name: "AgentRemount",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(id, 'printf "AGENTMARK\\r\\n"\r');
      await new Promise((r) => setTimeout(r, settleMs));
      const first = await window.electronAPI.pty.replay(id);
      window.electronAPI.pty.write(id, 'printf "AGENTLIVE\\r\\n"\r');
      await new Promise((r) => setTimeout(r, settleMs));
      const second = await window.electronAPI.pty.replay(id);
      window.electronAPI.pty.kill(id);
      return { first: first.join(""), secondChunks: second.length };
    }, SETTLE_MS);

    expect(result.first).toContain("AGENTMARK");
    expect(result.secondChunks).toBe(0);
  });

  test("@unit 오케 PTY 도 스폰 직후 resize 는 초기 80x24 프레임을 폐기한다 (#1047 유지)", async ({
    marblo,
  }) => {
    // #1047 이 지킨 반대쪽 회귀: 시간 창(PTY_INITIAL_FRAME_DISCARD_MS) 안의
    // resize 는 계속 초기 프레임을 버려야 한다 — 재생 링이 생겼다고 그 프레임이
    // 되살아나면 Gemini alt-screen 이 입력창 두 개로 뜬다.
    const result = await marblo.page.evaluate(async () => {
      const id = `orch-young-resize-${Date.now()}`;
      await window.electronAPI.pty.create({
        id,
        name: "OrchYoungResize",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(id, 'printf "STALEFRAME\\r\\n"\r');
      await new Promise((r) => setTimeout(r, 400));
      await window.electronAPI.pty.resize(id, 100, 30);
      await new Promise((r) => setTimeout(r, 150));
      const replayed = await window.electronAPI.pty.replay(id);
      window.electronAPI.pty.kill(id);
      return { text: replayed.join("") };
    });

    expect(result.text).not.toContain("STALEFRAME");
  });

  test("@unit 늦게 여는 오케 터미널은 그동안 쌓인 출력을 그대로 본다 (#1047 유지)", async ({
    marblo,
  }) => {
    const result = await marblo.page.evaluate(async () => {
      const id = `orch-late-mount-${Date.now()}`;
      await window.electronAPI.pty.create({
        id,
        name: "OrchLateMount",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(
        id,
        'printf "한글 늦은 마운트 LATE\\r\\n"\r',
      );
      // 초기 프레임 폐기 창(3s)을 넘긴 "한참 뒤에 연 터미널".
      await new Promise((r) => setTimeout(r, 3400));
      await window.electronAPI.pty.resize(id, 100, 30);
      await new Promise((r) => setTimeout(r, 150));
      const replayed = await window.electronAPI.pty.replay(id);
      window.electronAPI.pty.kill(id);
      return { text: replayed.join("") };
    });

    expect(result.text).toContain("LATE");
  });
});
