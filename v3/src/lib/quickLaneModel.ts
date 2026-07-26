/**
 * 퀵레인 모델 선택의 순수 헬퍼 — 카탈로그(벤더 → 구체 모델 → effort)를 다루는
 * 규칙만 담는다. DOM·store·IPC 없음이라 node 환경에서 그대로 유닛테스트된다.
 *
 * ★모델 id 리터럴이 이 파일에 하나도 없다. 카탈로그는 메인 프로세스가
 * `electron/model-registry.ts` 에서 파생해 IPC(`models:quickLaneCatalog`)로 내려주고,
 * 렌더러는 그 데이터를 표시·검증만 한다. 그래서 레지스트리에 행 하나를 넣으면
 * 퀵레인 셀렉터에 자동으로 나타나고, 여기 고칠 것은 없다.
 */

/** 퀵레인 한 건을 띄우는 데 필요한 선택의 전부. */
export interface QuickLaneSelection {
  /** 벤더 id(anthropic/openai/xai/zai/minimax…). 표시·집계 축. */
  vendor: string;
  /** 스폰할 바이너리. 에이전트 doc 의 `model` 필드가 된다. */
  harness: string;
  /** 에이전트 doc 의 `command` 필드. */
  command: string;
  /** 레지스트리 구체 모델 id. */
  modelId: string;
  /** 지정 effort(codex 계열). 빈 문자열 = CLI 기본값을 그대로 쓴다. */
  effort: string;
}

/**
 * `agent:launch` 에 넘길 모델 핀 문자열. effort 가 없으면 모델 id 단독이다
 * (main 의 `resolveModelPin` 이 이 표기를 dispatch_task 와 **같은 함수**로 판다).
 */
export function buildModelPin(selection: QuickLaneSelection): string {
  return selection.effort
    ? `${selection.modelId}@${selection.effort}`
    : selection.modelId;
}

/** 이 벤더 그룹을 지금 이 머신에서 쓸 수 있는가(= 필요한 env 키가 다 있는가). */
export function isVendorUsable(group: QuickLaneVendorGroup): boolean {
  return group.available;
}

/**
 * 카탈로그가 도착했을 때 처음 세울 선택.
 *
 * **쓸 수 있는** 첫 벤더의 첫 모델(= 능력등급 최상위)을 고른다. 키가 없는 env-swap
 * 벤더를 기본값으로 세우면 "시작" 을 누르는 순간 실패하는 화면이 되므로, 기본값은
 * 반드시 available 인 칸이어야 한다. 하나도 없으면 null(=선택 불가 상태).
 */
export function defaultSelection(
  groups: QuickLaneVendorGroup[],
): QuickLaneSelection | null {
  const group = groups.find((g) => isVendorUsable(g) && g.models.length > 0);
  if (!group) return null;
  return selectionFor(group, group.models[0], "");
}

/** 그룹 + 모델 + effort 로 선택을 조립한다(효력 없는 effort 는 조용히 떨군다). */
export function selectionFor(
  group: QuickLaneVendorGroup,
  model: QuickLaneModelOption,
  effort: string,
): QuickLaneSelection {
  return {
    vendor: group.vendor,
    harness: group.harness,
    command: group.command,
    modelId: model.modelId,
    // effort 축이 없는 모델(claude 계열 전부)에 effort 가 실려 오면 버린다 —
    // 살려두면 핀 문자열이 `claude-opus-5@high` 가 되고, main 이 그것을 경고와
    // 함께 떨구는 것을 매번 반복하게 된다. 애초에 만들지 않는 편이 낫다.
    effort: (model.efforts as string[]).includes(effort) ? effort : "",
  };
}

/**
 * 모델을 갈아탈 때 effort 를 이월한다 — 새 모델이 그 effort 를 지원할 때만.
 * (오케 셀렉터의 `withOrchestratorEffort` 와 같은 규칙. 두 셀렉터가 같은 감각으로
 * 동작해야 사용자가 규칙을 두 번 배우지 않는다.)
 */
export function carryEffort(
  model: QuickLaneModelOption,
  currentEffort: string,
): string {
  return (model.efforts as string[]).includes(currentEffort)
    ? currentEffort
    : "";
}

/** 셀렉터 요약 표기 — 버튼/배지에 한 줄로 넣는다. */
export function describeSelection(selection: QuickLaneSelection): string {
  return selection.effort
    ? `${selection.modelId}@${selection.effort}`
    : selection.modelId;
}
