/**
 * 회수된 트리거 문구의 계약.
 *
 * `google-restricted-scopes.ts` 머리주석의 규율: 막힌 기능은 (a) 무엇을 못 하고
 * (b) 왜 못 하며 (c) 대신 무엇을 쓰는지를 한 문장 안에서 말한다. 그리고 설계
 * §6.1(플랫폼별 능력표)의 정직성 조항: **없는 것을 없다고 말한다** — 대체가
 * macOS 전용이면 Windows·Linux 사용자가 그 사실을 그 자리에서 읽어야 한다.
 *
 * 문구는 코드가 아니라 사람이 고치는 것이므로, 검사도 "이 단어가 들어 있는가"
 * 수준에서 멈춘다. 문장을 다시 써도 이 계약만 지키면 테스트는 통과한다.
 */
import { describe, expect, it } from "vitest";
import { agents as enAgentsTable } from "../../src/locales/en/agents";
import { agents as koAgentsTable } from "../../src/locales/ko/agents";

const koAgents = koAgentsTable as Record<string, string>;
const enAgents = enAgentsTable as Record<string, string>;

const ADDED_KEYS = [
  "agents.triggers.calendar.heldBadge",
  "agents.triggers.calendar.heldNotice",
  "agents.triggers.gmail.heldBadge",
  "agents.triggers.gmail.heldNotice",
  "agents.triggers.validation.calendarTriggerWithheld",
  "agents.triggers.validation.gmailTriggerWithheld",
];

describe("캘린더·Gmail 회수 문구", () => {
  it("ko/en 양쪽에 있고 비어 있지 않다", () => {
    for (const key of ADDED_KEYS) {
      expect(koAgents[key], `ko is missing ${key}`).toBeTruthy();
      expect(enAgents[key], `en is missing ${key}`).toBeTruthy();
      expect(koAgents[key].length).toBeGreaterThan(1);
      expect(enAgents[key].length).toBeGreaterThan(1);
    }
  });

  it("★en 문구에 한국어가 섞여 들어오지 않는다 (#1254 회귀 방지)", () => {
    const hangul = /[가-힣]/;
    for (const key of ADDED_KEYS) {
      expect(hangul.test(enAgents[key]), `${key} contains Hangul`).toBe(false);
    }
  });

  it("왜 막혔는지를 스코프 이름으로 말한다 — '권한 없음' 으로 끝내지 않는다", () => {
    for (const table of [koAgents, enAgents]) {
      for (const key of [
        "agents.triggers.calendar.heldNotice",
        "agents.triggers.validation.calendarTriggerWithheld",
      ]) {
        expect(table[key]).toContain("calendar.readonly");
      }
      for (const key of [
        "agents.triggers.gmail.heldNotice",
        "agents.triggers.validation.gmailTriggerWithheld",
      ]) {
        expect(table[key]).toContain("gmail.readonly");
      }
    }
  });

  /**
   * ★이 티켓의 핵심 요구. 대체 경로가 macOS 전용이라는 사실과, Windows·Linux
   * 에는 대체가 없다는 사실을 **둘 다** 적어야 한다. 하나만 적으면 절반은
   * 거짓말이 된다.
   */
  it("대체 경로와 그 플랫폼 한계를 ko/en 양쪽에서 말한다", () => {
    const koCases: Array<[string, string]> = [
      ["agents.triggers.calendar.heldNotice", "애플 캘린더"],
      ["agents.triggers.validation.calendarTriggerWithheld", "애플 캘린더"],
      ["agents.triggers.gmail.heldNotice", "애플 메일"],
      ["agents.triggers.validation.gmailTriggerWithheld", "애플 메일"],
    ];
    for (const [key, replacement] of koCases) {
      expect(koAgents[key]).toContain(replacement);
      expect(koAgents[key]).toContain("macOS");
      expect(koAgents[key]).toContain("Windows");
      expect(koAgents[key]).toContain("Linux");
    }

    const enCases: Array<[string, string]> = [
      ["agents.triggers.calendar.heldNotice", "Apple Calendar"],
      ["agents.triggers.validation.calendarTriggerWithheld", "Apple Calendar"],
      ["agents.triggers.gmail.heldNotice", "Apple Mail"],
      ["agents.triggers.validation.gmailTriggerWithheld", "Apple Mail"],
    ];
    for (const [key, replacement] of enCases) {
      expect(enAgents[key]).toContain(replacement);
      expect(enAgents[key]).toContain("macOS");
      expect(enAgents[key]).toContain("Windows");
      expect(enAgents[key]).toContain("Linux");
    }
  });

  /**
   * 저장된 값을 지우지 않는다는 것은 코드의 사실이다(검증은 순수 함수다).
   * 사용자가 그 사실을 알아야 자기 설정을 잃었다고 오해하지 않는다.
   */
  it("설정값을 보관한다는 사실을 안내에 적는다", () => {
    expect(koAgents["agents.triggers.calendar.heldNotice"]).toContain("보관");
    expect(koAgents["agents.triggers.gmail.heldNotice"]).toContain("보관");
    expect(enAgents["agents.triggers.calendar.heldNotice"]).toContain("kept");
    expect(enAgents["agents.triggers.gmail.heldNotice"]).toContain("kept");
  });

  /**
   * ★`*ConnectorRequired` 는 보류가 풀린 뒤에만 나온다. 그 문구가 계속
   * "지금은 못 쓴다" 라고 말하면, 되살렸을 때 어느 쪽이 참인지 알 수 없다.
   */
  it("커넥터 문구는 회수가 아니라 연결을 말한다", () => {
    expect(
      koAgents["agents.triggers.validation.calendarConnectorRequired"],
    ).toContain("연결");
    expect(
      koAgents["agents.triggers.validation.gmailConnectorRequired"],
    ).toContain("연결");
    expect(
      enAgents["agents.triggers.validation.calendarConnectorRequired"],
    ).toContain("Reconnect");
    expect(
      enAgents["agents.triggers.validation.gmailConnectorRequired"],
    ).toContain("Reconnect");
  });
});
