/**
 * 비기너 오케 헤더의 "연결·인증된 모델만" 드롭다운이 쓰는 순수 필터.
 *
 * DOM·zustand 구독 없이 값만 받아 거른다 — 컴포넌트는 `useCliSetupStore` 의
 * `states` 스냅샷을 그대로 넘기기만 하면 되고, 이 파일은 node 환경에서 그대로
 * 유닛테스트된다.
 */
import {
  ORCHESTRATOR_MODEL_OPTIONS,
  orchestratorModelProvider,
} from "../stores/orchestratorStore";
import { ROWS, isCliReady, type CliState } from "../stores/cliSetupStore";

export type OrchestratorModelOption =
  (typeof ORCHESTRATOR_MODEL_OPTIONS)[number];

/** 이 모델 축의 프로바이더 CLI 가 설치+인증 둘 다 됐는가. */
export function isOrchestratorModelConnected(
  value: string,
  cliStates: Record<string, CliState | undefined>,
): boolean {
  const provider = orchestratorModelProvider(value);
  const row = ROWS.find((r) => r.model === provider);
  return row ? isCliReady(cliStates[row.id]) : false;
}

/**
 * 연결·인증된 모델만 남긴 셀렉터 목록.
 *
 * 지금 선택돼 있는 값(`selectedBase`)은 연결 여부와 무관하게 항상 포함한다 —
 * 아니면 controlled `<select>` 의 value 가 목록에 없는 옵션을 가리키게 되어
 * 브라우저가 그 값을 표시하지 못한다(제어 컴포넌트 값·옵션 불일치).
 */
export function connectedOrchestratorModelOptions(
  cliStates: Record<string, CliState | undefined>,
  selectedBase: string,
): readonly OrchestratorModelOption[] {
  return ORCHESTRATOR_MODEL_OPTIONS.filter(
    (option) =>
      option.value === selectedBase ||
      isOrchestratorModelConnected(option.value, cliStates),
  );
}
