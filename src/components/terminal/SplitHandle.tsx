import { useResizeHandle } from "../../hooks/use-resize-handle";
import type { SplitDirection } from "../../types";

interface SplitHandleProps {
  direction: SplitDirection;
  onResize: (delta: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export function SplitHandle({ direction, onResize, onResizeStart, onResizeEnd }: SplitHandleProps) {
  const handle = useResizeHandle({ direction, onResize, onResizeStart, onResizeEnd });

  const isHorizontal = direction === "horizontal";

  return (
    <div
      className={`
        relative z-10 flex-shrink-0
        ${isHorizontal ? "w-2.5 cursor-col-resize" : "h-2.5 cursor-row-resize"}
      `}
      {...handle}
    >
    </div>
  );
}
