/**
 * 심플 ↔ 어드밴스드 **입력 대기 알림** 표면 PARITY 가드 (ticket z4otodPWZTz1El1Ev7ll).
 *
 * 지키는 성질: 에이전트가 프롬프트 앞에서 사람을 기다리면 **양쪽 모드 모두**
 * 우상단에 알림이 뜨고, 클릭하면 그 에이전트의 터미널로 간다.
 *   - 어드밴스드: App → Layout / WorkspaceShell → <GlobalOverlays/> → 여기
 *   - 심플:       App → BeginnerShell (GlobalOverlays 를 마운트하지 않는다)
 *
 * 왜 이 가드가 필요한가: 이 기능이 **가장 필요한 쪽이 심플 모드**다. 그 셸은
 * 터미널을 아예 그리지 않으므로, 배선이 어드밴스드에만 있으면 "터미널이 보이는
 * 사람에게만 터미널을 보라고 알려주는" 알림이 된다 — 즉 정확히 아무도 구하지
 * 못한다. GlobalOverlays 는 심플 셸을 태우지 않으니 shell-global-overlays-parity
 * 의 보장이 여기서는 성립하지 않는다.
 *
 * 정적 소스 가드인 이유는 자매 테스트들과 같다: 두 셸 모두 앱 라이프사이클 훅
 * 수십 개를 끌고 와서 실제 렌더에는 무거운 목킹이 필요하다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../../src");
const ELECTRON = path.resolve(__dirname, "../../electron");

const read = (root: string, rel: string) =>
  readFileSync(path.join(root, rel), "utf-8");

const GLOBAL_OVERLAYS = read(SRC, "components/GlobalOverlays.tsx");
const BEGINNER_SHELL = read(SRC, "components/beginner/BeginnerShell.tsx");
const HOST = read(SRC, "components/agents/AgentInputWaitHost.tsx");
const STORE = read(SRC, "stores/agentAttentionStore.ts");
const AGENT_MANAGER = read(ELECTRON, "agent-manager.ts");

describe("에이전트 입력 대기 알림 — 심플/어드밴스드 배선", () => {
  it("어드밴스드 셸 경로(GlobalOverlays)가 알림 호스트를 마운트한다", () => {
    expect(GLOBAL_OVERLAYS).toMatch(/<AgentInputWaitHost\b/);
    expect(GLOBAL_OVERLAYS).toMatch(
      /import\s*\{\s*AgentInputWaitHost\s*\}\s*from\s*["']\.\/agents\/AgentInputWaitHost["']/,
    );
  });

  it("심플 셸(BeginnerShell)도 같은 호스트를 마운트한다", () => {
    expect(BEGINNER_SHELL).toMatch(/<AgentInputWaitHost\b/);
    expect(BEGINNER_SHELL).toMatch(
      /import\s*\{\s*AgentInputWaitHost\s*\}\s*from\s*["']\.\.\/agents\/AgentInputWaitHost["']/,
    );
  });

  it("두 표면은 같은 컴포넌트를 쓴다 (복제본 금지)", () => {
    expect(HOST).toMatch(/export function AgentInputWaitHost/);
    for (const source of [GLOBAL_OVERLAYS, BEGINNER_SHELL]) {
      expect(source.match(/<AgentInputWaitHost\b/g)?.length ?? 0).toBe(1);
    }
  });

  it("★심플 셸의 클릭 목적지는 그 셸의 에이전트 터미널 모달이다", () => {
    // 심플에는 Agents 탭도 AgentListPanel 도 없다. 기본 동작(엑스퍼트용
    // focusAgentTerminal)을 그대로 쓰면 클릭이 아무 데도 닿지 않는다 —
    // 알림은 뜨는데 눌러도 아무 일이 없는, 최악의 절반짜리 상태가 된다.
    expect(BEGINNER_SHELL).toMatch(
      /<AgentInputWaitHost\s+onOpen=\{openAgentTerminalById\}/,
    );
    expect(BEGINNER_SHELL).toMatch(/openAgentTerminal\(target\)/);
  });

  it("★엑스퍼트 기본 동작은 그 에이전트의 터미널을 실제로 띄운다", () => {
    // 탭 전환만으로는 부족하다 — 포커스를 그 에이전트로 옮겨야 FocusView(터미널)
    // 가 뜨고, 점프가 있어야 접힌 터미널 열/다른 탭에서도 그 패널이 보인다.
    expect(HOST).toMatch(/setFocusedAgent\(agentId\)/);
    expect(HOST).toMatch(/requestJump\(\{\s*type:\s*["']agent["']/);
  });

  it("알림은 에이전트당 하나 — 스토어가 agentId 키 맵이다", () => {
    // 중복방지를 렌더 시점의 필터가 아니라 자료구조로 지킨다.
    expect(STORE).toMatch(/waiting:\s*Record<string,\s*AgentInputWait>/);
  });

  it("★감지는 #935 신호를 재사용한다 — 새 검출기를 만들지 않는다", () => {
    // classifyPtyFrame 의 결과를 그대로 접는다. 별도 파서가 생기면 두 판정이
    // 갈리고, 와치독과 알림이 서로 다른 세계를 보게 된다.
    expect(AGENT_MANAGER).toMatch(
      /const kind = classifyPtyFrame\(chunk, agent\.model\)/,
    );
    expect(AGENT_MANAGER).toMatch(/this\.refreshInputWait\(params\.id, kind\)/);
    expect(AGENT_MANAGER).toMatch(/foldInputWait\(/);
  });

  it("★바이패스 최초실행 프롬프트는 알림이 아니라 자동 응답으로 사라진다", () => {
    expect(AGENT_MANAGER).toMatch(/this\.maybeAcceptBypassConsent\(params\.id/);
    expect(AGENT_MANAGER).toMatch(/shouldAutoAcceptBypass\(/);
  });
});
