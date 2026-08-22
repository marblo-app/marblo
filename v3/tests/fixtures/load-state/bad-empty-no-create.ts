import type { LoadState } from "../../../src/components/common/loadState";
// ★empty 에 primary 행동(create)이 없다 — 예쁜 빈 화면. 막혀야 한다.
export const s: LoadState = {
  kind: "empty",
  hint: "common.state.reason.notCollected",
};
