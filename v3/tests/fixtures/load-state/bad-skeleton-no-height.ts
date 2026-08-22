import { createElement } from "react";
import { Skeleton } from "../../../src/components/common/Skeleton";
// ★Skeleton 에 height 가 없다 — 막혀야 한다.
export const el = createElement(Skeleton, { width: "6ch" });
