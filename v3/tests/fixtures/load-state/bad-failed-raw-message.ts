import type { LoadState } from "../../../src/components/common/loadState";
// ★err.message 원문을 reasonCode 에 넣으려 한다 — 막혀야 한다(i18n 키만 허용).
export function make(err: Error): LoadState {
  return { kind: "failed", reasonCode: err.message, retry: () => {} };
}
