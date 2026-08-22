import { createElement } from "react";
import { StateBlock } from "../../../src/components/common/StateBlock";
// ★block 이 minHeight 를 안 받는다 — 골격 높이를 모르면 막혀야 한다.
export const el = createElement(StateBlock, {
  variant: "block",
  state: { kind: "loading" },
  children: () => null,
});
