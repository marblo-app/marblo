import { useCallback, useRef } from "react";
import {
  usePaneStore,
  type LayoutNode,
  type SplitNode,
} from "../../stores/paneStore";
import { PaneGroup } from "./PaneGroup";

/**
 * Recursively renders the pane split tree. `group` leaves become PaneGroups;
 * `split` nodes become a flex row/column with a draggable divider between the
 * two children.
 */
export function LayoutView({ node }: { node: LayoutNode }) {
  const focusedGroupId = usePaneStore((s) => s.focusedGroupId);

  if (node.type === "group") {
    return <PaneGroup group={node} isFocused={node.id === focusedGroupId} />;
  }
  return <SplitView split={node} />;
}

function SplitView({ split }: { split: SplitNode }) {
  const setSplitSizes = usePaneStore((s) => s.setSplitSizes);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isRow = split.direction === "row";

  const onDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const move = (ev: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const frac = isRow
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
        setSplitSizes(split.id, [frac, 1 - frac]);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [isRow, split.id, setSplitSizes]
  );

  return (
    <div
      ref={containerRef}
      className={`flex h-full min-h-0 min-w-0 ${
        isRow ? "flex-row" : "flex-col"
      }`}
    >
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{
          flexBasis: `${split.sizes[0] * 100}%`,
          flexGrow: 0,
          flexShrink: 0,
        }}
      >
        <LayoutView node={split.children[0]} />
      </div>

      <div
        onMouseDown={onDividerDown}
        className={`flex-shrink-0 bg-gray-700 hover:bg-blue-600 ${
          isRow ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
        }`}
      />

      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{
          flexBasis: `${split.sizes[1] * 100}%`,
          flexGrow: 1,
          flexShrink: 1,
        }}
      >
        <LayoutView node={split.children[1]} />
      </div>
    </div>
  );
}
