/**
 * 계정 귀속 렌더러 상태의 **단일 초크포인트** — 티켓 GOiAnCMjqrEPNcmBaiBY (P0).
 *
 * ★왜 필요한가 (심각도 판정 (a)):
 *   datagadapida 로 로그인했는데 john.kim 의 프로젝트가 리스트에 보였다. 원인은
 *   Firestore rules 가 아니다 — 룰은 `projects` 를 members 로 격리하고 있고,
 *   **이전 계정 uid 로 스코프한 쿼리조차 permission-denied** 로 떨어진다
 *   (firestore.rules.test.ts "projects 계정 격리 (list 쿼리)"). 서버는
 *   fail-closed 였다. 남의 프로젝트를 화면에 남긴 건 렌더러였다: 로그아웃은
 *   `signOut(auth)` 만 했고, 이전 계정의 스냅샷 결과를 들고 있던 zustand
 *   스토어들은 아무도 비우지 않았다. 새 계정으로 로그인해도 그 배열은 새
 *   스냅샷이 덮어쓰기 전까지 그대로 화면에 남는다.
 *
 * ★왜 "새 스냅샷이 곧 덮어쓴다" 로는 부족한가:
 *   덮어쓰기는 네트워크 왕복 뒤에 온다. 그 사이의 렌더는 **새 계정 신원 + 옛
 *   계정 데이터**다. 한 프레임이라도 그렇게 그려지면 그게 곧 계정 격리 위반이다
 *   (사용자가 실제로 본 것도 그 화면이다). 그래서 신원이 바뀌는 순간
 *   **동기적으로** 비운다 — 지우는 것은 언제나 안전하고, 남기는 것만 위험하다.
 *
 * ★왜 레지스트리가 아니라 명시적 목록인가:
 *   등록형(register-on-import)은 아직 import 되지 않은 스토어가 조용히 빠진다 —
 *   격리에서 "조용히 빠짐" 은 곧 누출이다. 여기 적힌 목록이 감사 가능한 단일
 *   진실이다. **계정/프로젝트에 귀속된 스토어를 새로 추가하면 여기에도 추가할 것.**
 *
 * 기기 귀속 상태(machineId 등)는 계정과 무관하므로 건드리지 않는다.
 */

import { useAgentStore } from "../stores/agentStore";
import { useProjectStore } from "../stores/projectStore";
import { useSubscriptionStore } from "../stores/subscriptionStore";
import { useTaskStore } from "../stores/taskStore";

export function resetAccountScopedState(): void {
  // 프로젝트가 먼저다: 보드/에이전트 구독은 currentProject 에 매달려 있으므로
  // 여기서 끊어 두면 뒤따르는 클리어가 되살아나지 않는다.
  useProjectStore.getState().resetForAccountChange();
  useTaskStore.setState({ tasks: [], loading: false });
  useAgentStore.setState({
    agents: [],
    ownedAgents: [],
    loading: false,
    hydrated: false,
    error: null,
  });
  useSubscriptionStore.setState({ subscription: null, loading: false });
}
