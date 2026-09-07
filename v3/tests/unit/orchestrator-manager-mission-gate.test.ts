/**
 * 라우팅 게이트에 미션 묶기 기준이 들어갔는지 확인한다(티켓 jmEZFHM9Qd1c6EyfPjQd,
 * 사장님 지시 2026-09-07). `BOARD_ORCHESTRATOR_ROUTING_GATE` 는 비공개
 * 상수라 직접 못 읽고, 그걸 그대로 담는 공개 함수 `buildCodexBootInstructions`
 * 를 통해서 본다.
 *
 * ★고정하는 것: 순서 있는 티켓 2개 이상 + 한 목적일 때만 mission_label 을
 * create_task/create_tasks_bulk(생성 시점)·add_work_chain_item 에 붙이라고
 * 말하고, 단발 티켓·독립 티켓·질문/버그 답변은 미션이 아니라고 못 박는다.
 */

import { describe, it, expect } from "vitest";
import { buildCodexBootInstructions } from "../../electron/orchestrator-manager";

describe("라우팅 게이트 — 미션 묶기 기준", () => {
  const gate = buildCodexBootInstructions({ surface: null, locale: null });

  it("★순서 있는 2+ 티켓 + 한 목적 기준이 들어 있다", () => {
    expect(gate.includes("2+ ordered tickets")).toBe(true);
    expect(gate.includes("B needs A first")).toBe(true);
  });

  it("★mission_label 을 create_task/create_tasks_bulk(생성 시점)·add_work_chain_item 에 붙이라고 말한다", () => {
    expect(gate.includes("mission_label")).toBe(true);
    expect(gate.includes("create_task/create_tasks_bulk")).toBe(true);
    expect(gate.includes("at creation")).toBe(true);
    expect(gate.includes("add_work_chain_item")).toBe(true);
  });

  it("★과잉 방지 — 단발/독립 티켓, 질문·수정은 미션이 아니라고 명시한다", () => {
    expect(gate.includes("NOT a mission")).toBe(true);
    expect(gate.includes("Single or independent tickets")).toBe(true);
  });

  it("★추가 분량이 300자를 넘지 않는다(매 턴 주입 비용)", () => {
    const marker = "Do not solve these inline. ";
    const idx = gate.indexOf(marker);
    expect(idx).toBeGreaterThanOrEqual(0);
    const afterMarker = gate.slice(idx + marker.length);
    const nextSentenceIdx = afterMarker.indexOf("B) questions");
    expect(nextSentenceIdx).toBeGreaterThan(0);
    const addedClause = afterMarker.slice(0, nextSentenceIdx).trim();
    expect(addedClause.length).toBeLessThanOrEqual(300);
  });
});
