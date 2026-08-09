import { createTask } from "./taskService";
import type { TicketDraft } from "../lib/onrampDecompose";

/**
 * L0 분해 결과 → **진짜 보드** (설계 §4-E).
 *
 * ★가짜 보드를 그리지 않는 것이 이 파일의 존재 이유다. 불변식 I3: "아래층에서
 * 만든 것은 위층에서 그대로 살아남는다." L0 에서 만든 티켓이 CLI 인증 후
 * 그대로 실행돼야 사다리이고, 프리뷰였다면 유저는 같은 말을 두 번 해야 한다.
 *
 * 그래서 신규 경로가 없다 — `taskService.createTask` 를 그대로 쓴다. 권한도
 * 이미 열려 있다(`firestore.rules`: tasks create = 프로젝트 멤버. **CLI 인증과
 * 무관**하므로 L0 에서 이미 된다).
 *
 * ★순차 생성인 이유: `dependsOn` 은 taskId 배열인데 초안은 order 로만 선행을
 * 가리킨다(`dependsOnOrder`). 앞 티켓의 id 를 알아야 뒤 티켓을 쓸 수 있으므로
 * 병렬화하지 않는다. 초안이 최대 7장이라 지연도 문제가 되지 않는다.
 */

export interface OnrampTicketCreation {
  createdIds: string[];
  /** 한 장이라도 실패했는가 — 화면이 "일부만 만들어졌어요" 를 말할 수 있게. */
  partial: boolean;
}

export async function createOnrampDemoTickets(
  projectId: string,
  drafts: TicketDraft[],
  meta: { matchedRule: string; fallback: boolean },
): Promise<OnrampTicketCreation> {
  const createdIds: string[] = [];
  /** order → taskId. 선행 참조를 실제 id 로 바꾸는 데 쓴다. */
  const idByOrder = new Map<number, string>();
  let partial = false;

  for (const draft of drafts) {
    const dependsOnId =
      draft.dependsOnOrder !== undefined
        ? idByOrder.get(draft.dependsOnOrder)
        : undefined;
    try {
      const id = await createTask({
        projectId,
        contextId: "board",
        title: draft.title,
        description: draft.description,
        status: "TODO",
        role: draft.role,
        // 3 = 기본 우선순위. 데모 티켓이 진짜 작업보다 위에 서면 안 된다.
        priority: 3,
        dependsOn: dependsOnId ? [dependsOnId] : [],
        // 선행이 있으면 아직 안 풀린 상태로 시작한다 — 보드의 의존성 게이트가
        // 이 플래그를 읽는다(edge-trigger 규율은 게이트 쪽 몫).
        dependsOnCompleted: !dependsOnId,
        claimedBy: null,
        claimedAt: null,
        scope: [],
        comment: "",
        prUrl: "",
        hasPmFeedback: false,
        origin: "onramp_demo",
        originRule: meta.matchedRule,
        originFallback: meta.fallback,
      });
      createdIds.push(id);
      idByOrder.set(draft.order, id);
    } catch {
      // ★한 장이 실패해도 나머지를 포기하지 않는다. 여기서 throw 하면 이미 만든
      // 티켓은 보드에 남고 화면은 실패만 말하게 되는데, 그건 유저가 보는 것과
      // 우리가 하는 말이 어긋나는 최악의 조합이다.
      partial = true;
    }
  }

  return { createdIds, partial };
}
