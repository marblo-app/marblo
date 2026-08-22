import type { LoadState } from "../../../src/components/common/loadState";
// ★not_ready 에 availableWhen 도 enable 도 없다 — 막혀야 한다.
export const s: LoadState = {
  kind: "not_ready",
  reasonCode: "common.state.reason.notCollected",
};
