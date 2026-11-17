import type { FileTab } from "../lib/types";

interface Props {
  tabs: FileTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export default function TabBar({ tabs, activeId, onSelect, onClose }: Props) {
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab ${tab.id === activeId ? "active" : ""}`}
          onClick={() => onSelect(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(tab.id); // 中键关闭
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const menu = document.getElementById("tab-context-menu");
            if (menu) {
              menu.style.display = "block";
              menu.style.left = `${e.clientX}px`;
              menu.style.top = `${e.clientY}px`;
              menu.dataset.tabId = tab.id;
            }
          }}
          title={tab.path ?? "未保存的新文件"}
        >
          <span className={`tab-dot ${tab.dirty ? "dirty" : ""}`}>{tab.dirty ? "●" : ""}</span>
          <span className="tab-name">{tab.name}</span>
          <button
            className="tab-close"
            aria-label={`关闭 ${tab.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
