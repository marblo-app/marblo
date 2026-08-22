import type { LoadState } from "../../../src/components/common/loadState";
// ★empty 에 만드는 법 한 문장(hint)이 없다 — 막혀야 한다.
export const s: LoadState = {
  kind: "empty",
  create: { label: "common.state.action.create", onClick: () => {} },
};
