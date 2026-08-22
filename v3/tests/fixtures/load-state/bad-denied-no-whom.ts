import type { LoadState } from "../../../src/components/common/loadState";
// ★denied 에 askWhom 이 없다 — 누구에게 요청하는지 없으면 막혀야 한다.
export const s: LoadState = {
  kind: "denied",
  reasonCode: "common.state.reason.ownerOnly",
};
