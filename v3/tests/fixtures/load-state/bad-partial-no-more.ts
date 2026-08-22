import type { LoadState } from "../../../src/components/common/loadState";
// ★partial 에 showMore 가 없다 — 막혀야 한다.
export const s: LoadState = { kind: "partial", shown: 3, total: 10 };
