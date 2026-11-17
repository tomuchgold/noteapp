import { useRef } from "react";

interface Props {
  /** 拖动产生的水平位移（px，向右为正） */
  onDelta: (dx: number) => void;
  /** 双击复位 */
  onReset?: () => void;
}

/** 垂直拖动条：置于水平 flex 容器内，拖动调整相邻面板宽度 */
export default function Splitter({ onDelta, onReset }: Props) {
  const startX = useRef<number | null>(null);

  return (
    <div
      className="splitter"
      title="拖动调整宽度，双击复位"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        startX.current = e.clientX;
        (e.currentTarget as HTMLElement).dataset.dragging = "true";
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (startX.current === null) return;
        onDelta(e.clientX - startX.current);
        startX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        startX.current = null;
        (e.currentTarget as HTMLElement).dataset.dragging = "false";
        document.body.classList.remove("resizing");
      }}
      onPointerCancel={(e) => {
        startX.current = null;
        (e.currentTarget as HTMLElement).dataset.dragging = "false";
        document.body.classList.remove("resizing");
      }}
      onDoubleClick={() => onReset?.()}
    />
  );
}
