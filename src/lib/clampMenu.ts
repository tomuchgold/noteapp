/**
 * v0.29：右键/弹出菜单视口钳制。
 * 菜单以 fixed + left/top 定位，渲染后测量自身尺寸，
 * 若超出视口（右/下边缘）则平移到视口内（留 8px 边距）。
 * 用法：const ref = useClampMenu([menu]); <div ref={ref} style={{left: menu.x, top: menu.y}} />
 */
import { useLayoutEffect, useRef } from "react";

export function useClampMenu(deps: unknown[], margin = 8) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 未显示（display:none）时 offsetWidth 为 0，跳过
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w === 0 || h === 0) return;
    let x = Number.parseFloat(el.style.left || "0");
    let y = Number.parseFloat(el.style.top || "0");
    if (Number.isNaN(x)) x = 0;
    if (Number.isNaN(y)) y = 0;
    const maxX = window.innerWidth - w - margin;
    const maxY = window.innerHeight - h - margin;
    if (x > maxX) x = Math.max(margin, maxX);
    if (y > maxY) y = Math.max(margin, maxY);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
