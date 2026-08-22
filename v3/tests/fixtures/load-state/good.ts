// 모든 상태를 "다음 행동" 과 함께 구성 — 전부 컴파일돼야 한다.
import { createElement } from "react";
import type { LoadState } from "../../../src/components/common/loadState";
import { StateBlock } from "../../../src/components/common/StateBlock";
import { Skeleton } from "../../../src/components/common/Skeleton";

const noop = () => {};

export const states: LoadState[] = [
  { kind: "loading" },
  { kind: "loading", since: 0, cancel: noop },
  { kind: "ready" },
  {
    kind: "empty",
    hint: "common.state.reason.notCollected",
    create: { label: "common.state.action.create", onClick: noop },
  },
  {
    kind: "failed",
    reasonCode: "common.state.reason.network",
    detail: "TypeError: Failed to fetch",
    retry: noop,
  },
  { kind: "denied", reasonCode: "common.state.reason.ownerOnly", askWhom: "오너" },
  {
    kind: "denied",
    reasonCode: "common.state.reason.ownerOnly",
    askWhom: "오너",
    onAsk: noop,
  },
  {
    kind: "not_ready",
    reasonCode: "common.state.reason.notCollected",
    availableWhen: { key: "common.state.partial.title", vars: { shown: 1, total: 2 } },
  },
  {
    kind: "not_ready",
    reasonCode: "common.state.reason.notCollected",
    enable: { label: "common.state.action.create", onClick: noop },
  },
  { kind: "partial", shown: 3, total: 10, showMore: noop },
];

export const block = createElement(StateBlock, {
  variant: "block",
  state: states[0]!,
  minHeight: 240,
  children: () => null,
});
export const inline = createElement(StateBlock, {
  variant: "inline",
  state: states[0]!,
  children: () => "0",
});
export const banner = createElement(StateBlock, { variant: "banner", state: states[0]! });
export const skeleton = createElement(Skeleton, { height: 24, width: "6ch" });
