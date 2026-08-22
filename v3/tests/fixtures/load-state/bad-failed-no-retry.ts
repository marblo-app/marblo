import type { LoadState } from "../../../src/components/common/loadState";
// ★failed 에 retry 가 없다 — 컴파일이 막혀야 한다.
export const s: LoadState = {
  kind: "failed",
  reasonCode: "common.state.reason.network",
};
