import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import Editor from "./components/Editor";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import DiffView from "./components/DiffView";
import DiffDialog, { type DiffSource } from "./components/DiffDialog";
import Sidebar from "./components/Sidebar";
import FileList from "./components/FileList";
import FolderTree, { loadSavedFolder } from "./components/FolderTree";
import SettingsDialog from "./components/SettingsDialog";
import Splitter from "./components/Splitter";
import AiSettingsDialog from "./components/AiSettingsDialog";
import AiResultDialog from "./components/AiResultDialog";
import AiCustomDialog from "./components/AiCustomDialog";
import {
  AI_ACTIONS,
  isConfigured,
  loadAiConfig,
  resolveConfig,
  runAiAction,
  saveAiConfig,
  type AiAction,
  type AiConfig,
} from "./lib/ai";
import {
  openFileDialog,
  pushRecent,
  readTextFile,
  saveFileDialog,
  writeTextFile,
  getRecent,
  openDirectoryDialog,
} from "./lib/files";
import {
  clampFilelistWidth,
  clampSidebarWidth,
  DEFAULT_LAYOUT,
  loadLayout,
  saveLayout,
  type LayoutState,
} from "./lib/layout";
import { clampSettings, loadSettings, saveSettings, type EditorSettings } from "./lib/settings";
import {
  VIRTUAL,
  filterFiles,
  loadCategories,
  loadLibrary,
  patchFile,
  removeFile,
  saveCategories,
  saveLibrary,
  upsertFile,
  type Category,
  type LibraryFile,
} from "./lib/library";
import { detectLanguage } from "./lib/lang";
import type { FileTab, MacroItem } from "./lib/types";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const ENCODINGS = ["UTF-8", "GBK"];
const SESSION_KEY = "notepp.session";

export default function App() {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1, selected: 0 });
  const [confirmState, setConfirmState] = useState<{
    tabId: string;
    onDone: () => void;
  } | null>(null);
  const [recent, setRecent] = useState<string[]>(getRecent());
  const [actionSignal, setActionSignal] = useState<{
    type: string;
    n: number;
    items?: MacroItem[];
    text?: string;
  } | null>(null);
  const [diff, setDiff] = useState<{ aText: string; bText: string; aName: string; bName: string } | null>(null);
  const [diffDialog, setDiffDialog] = useState(false);
  const [recording, setRecording] = useState(false);
  const [macroLen, setMacroLen] = useState(0);
  const macroRef = useRef<MacroItem[]>([]);
  const actionCount = useRef(0);
  const sessionLoaded = useRef(false);

  // ---------- 文件库 / 分类 ----------
  const [library, setLibrary] = useState<LibraryFile[]>(() => loadLibrary());
  const [categories, setCategories] = useState<Category[]>(() => loadCategories());
  const [catKey, setCatKey] = useState<string>(VIRTUAL.all);
  const [query, setQuery] = useState("");
  // ---------- 三栏布局（显隐 + 宽度持久化） ----------
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout());
  useEffect(() => saveLayout(layout), [layout]);
  const patchLayout = useCallback((patch: Partial<LayoutState>) => {
    setLayout((l) => ({ ...l, ...patch }));
  }, []);

  // ---------- 编辑器样式设置 ----------
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => saveSettings(editorSettings), [editorSettings]);
  const zoomEditor = useCallback((dir: 1 | -1) => {
    setEditorSettings((s) =>
      clampSettings({ ...s, fontSize: s.fontSize + dir * 1 })
    );
  }, []);

  // ---------- 文件夹浏览 ----------
  const [folderRoot, setFolderRoot] = useState<string | null>(() => loadSavedFolder());

  // ---------- AI ----------
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig());
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiJob, setAiJob] = useState<{
    title: string;
    action: AiAction;
    source: string;
    custom?: string;
    loading: boolean;
    error: string | null;
    result: string;
    model?: string;
    tokens?: number;
  } | null>(null);
  const [aiCustom, setAiCustom] = useState<{ source: string } | null>(null);
  useEffect(() => saveAiConfig(aiConfig), [aiConfig]);
  const aiReady = isConfigured(aiConfig);

  const runAi = useCallback(
    async (action: AiAction, source: string, custom?: string) => {
      const title = AI_ACTIONS.find((a) => a.id === action)?.label ?? "AI 操作";
      setAiJob({ title, action, source, custom, loading: true, error: null, result: "" });
      try {
        const res = await runAiAction(aiConfig, action, source, custom);
        setAiJob((j) =>
          j ? { ...j, loading: false, result: res.content, model: res.model, tokens: res.tokens } : j
        );
      } catch (e) {
        setAiJob((j) =>
          j ? { ...j, loading: false, error: String(e instanceof Error ? e.message : e) } : j
        );
      }
    },
    [aiConfig]
  );

  const handleAiAction = useCallback(
    (action: AiAction, text: string) => {
      if (!aiReady) {
        setAiSettingsOpen(true);
        return;
      }
      if (action === "custom") {
        setAiCustom({ source: text });
        return;
      }
      void runAi(action, text);
    },
    [aiReady, runAi]
  );

  const writeAiText = useCallback((mode: "ai-replace" | "ai-insert", text: string) => {
    actionCount.current += 1;
    setActionSignal({ type: mode, n: actionCount.current, text });
    setAiJob(null);
  }, []);

  useEffect(() => saveLibrary(library), [library]);
  useEffect(() => saveCategories(categories), [categories]);

  const viewFiles = useMemo(
    () => filterFiles(library, catKey, query, categories),
    [library, catKey, query, categories]
  );

  const viewTitle = useMemo(() => {
    if (catKey === VIRTUAL.all) return "全部文件";
    if (catKey === VIRTUAL.fav) return "收藏";
    if (catKey === VIRTUAL.recent) return "最近";
    if (catKey === VIRTUAL.none) return "未分类";
    return categories.find((c) => c.id === catKey)?.name ?? "全部文件";
  }, [catKey, categories]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId]
  );

  const updateTab = useCallback((id: string, patch: Partial<FileTab>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /** 打开单个路径（去重：已打开则激活） */
  const openPath = useCallback(async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    try {
      const res = await readTextFile(path);
      pushRecent(path);
      setRecent(getRecent());
      setLibrary((prev) => upsertFile(prev, path, res.content));
      const tab: FileTab = {
        id: newId(),
        path,
        name: baseName(path),
        content: res.content,
        dirty: false,
        encoding: res.encoding,
        bom: res.bom,
        eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
      };
      setTabs((ts) => [...ts, tab]);
      setActiveId(tab.id);
    } catch (e) {
      alert(`打开文件失败：${e}`);
    }
  }, [tabs]);

  const newTab = useCallback(() => {
    const n = tabs.filter((t) => t.path === null).length;
    const tab: FileTab = {
      id: newId(),
      path: null,
      name: n === 0 ? "新文件" : `新文件 (${n + 1})`,
      content: "",
      dirty: false,
      encoding: "UTF-8",
      bom: false,
      eol: "LF",
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }, [tabs]);

  const openDialog = useCallback(async () => {
    const paths = await openFileDialog();
    if (paths) for (const p of paths) await openPath(p);
  }, [openPath]);

  // ---------- 文件对比 ----------
  const resolveDiffSource = useCallback(
    async (src: DiffSource): Promise<{ text: string; name: string } | null> => {
      if (src.kind === "tab") return { text: src.tab.content, name: src.tab.name };
      const picked = await openFileDialog();
      if (!picked || picked.length === 0) return null;
      try {
        const res = await readTextFile(picked[0]);
        return { text: res.content, name: baseName(picked[0]) };
      } catch (e) {
        alert(`读取文件失败：${e}`);
        return null;
      }
    },
    []
  );

  const startDiff = useCallback(
    async (a: DiffSource, b: DiffSource) => {
      setDiffDialog(false);
      const ra = await resolveDiffSource(a);
      const rb = await resolveDiffSource(b);
      if (!ra || !rb) return;
      setDiff({ aText: ra.text, aName: ra.name, bText: rb.text, bName: rb.name });
    },
    [resolveDiffSource]
  );

  // ---------- 会话恢复：启动时还原上次打开的标签 ----------
  useEffect(() => {
    if (sessionLoaded.current) return;
    sessionLoaded.current = true;
    (async () => {
      let session: { paths: string[]; activePath: string | null } | null = null;
      try {
        session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
      } catch {
        session = null;
      }
      const paths = session?.paths ?? [];
      const loaded: FileTab[] = [];
      for (const p of paths) {
        try {
          const res = await readTextFile(p);
          loaded.push({
            id: newId(),
            path: p,
            name: baseName(p),
            content: res.content,
            dirty: false,
            encoding: res.encoding,
            bom: res.bom,
            eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
          });
        } catch {
          // 文件已失效（被移动/删除），跳过
        }
      }
      if (loaded.length === 0) {
        newTab();
        return;
      }
      setTabs(loaded);
      const active =
        loaded.find((t) => t.path === session?.activePath) ?? loaded[0];
      setActiveId(active.id);
    })();
  }, [newTab]);

  // ---------- 会话持久化：标签变化时保存路径列表 ----------
  useEffect(() => {
    if (!sessionLoaded.current) return;
    const paths = tabs.filter((t) => t.path).map((t) => t.path!);
    const activePath = tabs.find((t) => t.id === activeId && t.path)?.path ?? null;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ paths, activePath }));
  }, [tabs, activeId]);

  /** 保存；forceDialog 用于另存为。返回是否成功保存 */
  const saveTab = useCallback(async (tab: FileTab, forceDialog = false): Promise<boolean> => {
    let path = tab.path;
    if (!path || forceDialog) {
      const picked = await saveFileDialog(tab.name);
      if (!picked) return false; // 用户取消
      path = picked;
    }
    const eol = tab.eol === "MIXED" ? "LF" : tab.eol;
    try {
      await writeTextFile({
        path,
        content: tab.content,
        encoding: tab.encoding,
        bom: tab.bom,
        eol,
      });
      pushRecent(path);
      setRecent(getRecent());
      setLibrary((prev) => upsertFile(prev, path!, tab.content));
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tab.id
            ? { ...t, path, name: baseName(path!), dirty: false, eol }
            : t
        )
      );
      return true;
    } catch (e) {
      alert(`保存失败：${e}`);
      return false;
    }
  }, []);

  /** 关闭标签：脏文件先确认 */
  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      const doClose = () => {
        setTabs((ts) => {
          const idx = ts.findIndex((t) => t.id === id);
          const rest = ts.filter((t) => t.id !== id);
          if (id === activeId) {
            const next = rest[Math.min(idx, rest.length - 1)];
            setActiveId(next ? next.id : null);
          }
          return rest;
        });
      };
      if (tab.dirty) {
        setConfirmState({ tabId: id, onDone: doClose });
      } else {
        doClose();
      }
    },
    [tabs, activeId]
  );

  // ---------- 文件库操作 ----------
  const toggleFav = useCallback((path: string) => {
    setLibrary((prev) => {
      const f = prev.find((x) => x.path === path);
      return patchFile(prev, path, { favorite: !f?.favorite });
    });
  }, []);

  const assignCategory = useCallback((path: string, category: string | null) => {
    setLibrary((prev) => patchFile(prev, path, { category }));
  }, []);

  const removeFromLibrary = useCallback((path: string) => {
    setLibrary((prev) => removeFile(prev, path));
  }, []);

  const createCategory = useCallback((name: string, color: string) => {
    const id = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setCategories((prev) => [...prev, { id, name, color }]);
    setCatKey(id);
  }, []);

  const renameCategory = useCallback((id: string, name: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const deleteCategory = useCallback(
    (id: string) => {
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setLibrary((prev) =>
        prev.map((f) => (f.category === id ? { ...f, category: null } : f))
      );
      setCatKey((k) => (k === id ? VIRTUAL.all : k));
    },
    []
  );

  // ---------- 宏录制与回放 ----------
  const toggleRecord = useCallback(() => {
    if (recording) {
      setRecording(false);
    } else {
      macroRef.current = [];
      setMacroLen(0);
      setRecording(true);
    }
  }, [recording]);

  const replayMacro = useCallback(() => {
    if (recording || macroRef.current.length === 0) return;
    actionCount.current += 1;
    setActionSignal({
      type: "macro-replay",
      n: actionCount.current,
      items: [...macroRef.current],
    });
  }, [recording]);

  // 录制中捕获按键（排除应用级快捷键与纯修饰键）
  useEffect(() => {
    if (!recording) return;
    const APP_KEYS = new Set(["n", "o", "s", "w", "f", "tab", "r", "p"]);
    const onKey = (e: KeyboardEvent) => {
      if (["Control", "Shift", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && APP_KEYS.has(e.key.toLowerCase())) return;
      const item: MacroItem =
        e.key.length === 1 && !mod && !e.altKey
          ? { type: "text", text: e.key }
          : { type: "cmd", cmd: e.key };
      macroRef.current.push(item);
      setMacroLen(macroRef.current.length);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  // ---------- 快捷键 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        newTab();
      } else if (key === "o") {
        e.preventDefault();
        openDialog();
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        if (activeTab) saveTab(activeTab);
      } else if (key === "s" && e.shiftKey) {
        e.preventDefault();
        if (activeTab) saveTab(activeTab, true);
      } else if (key === "w") {
        e.preventDefault();
        if (activeId) closeTab(activeId);
      } else if (key === "b" && e.shiftKey) {
        e.preventDefault();
        setLayout((l) => ({ ...l, filelistOpen: !l.filelistOpen }));
      } else if (key === "b") {
        e.preventDefault();
        setLayout((l) => ({ ...l, sidebarOpen: !l.sidebarOpen }));
      } else if (key === "f") {
        e.preventDefault();
        actionCount.current += 1;
        setActionSignal({ type: "find", n: actionCount.current });
      } else if (key === "r" && e.shiftKey) {
        e.preventDefault();
        toggleRecord();
      } else if (key === "p" && e.shiftKey) {
        e.preventDefault();
        replayMacro();
      } else if (key === "tab") {
        e.preventDefault();
        if (tabs.length > 1 && activeId) {
          const idx = tabs.findIndex((t) => t.id === activeId);
          setActiveId(tabs[(idx + 1) % tabs.length].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newTab, openDialog, saveTab, closeTab, activeTab, activeId, tabs, toggleRecord, replayMacro]);

  // 状态栏点击：循环切换保存编码
  useEffect(() => {
    const onCycle = () => {
      if (!activeId) return;
      setTabs((ts) =>
        ts.map((t) =>
          t.id === activeId
            ? {
                ...t,
                encoding:
                  ENCODINGS[(ENCODINGS.indexOf(t.encoding) + 1) % ENCODINGS.length] ??
                  "UTF-8",
                dirty: true,
              }
            : t
        )
      );
    };
    window.addEventListener("notepp.cycle-encoding", onCycle);
    return () => window.removeEventListener("notepp.cycle-encoding", onCycle);
  }, [activeId]);

  // ---------- 拖拽打开文件 ----------
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        for (const p of event.payload.paths) openPath(p);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openPath]);

  // 标题栏
  useEffect(() => {
    document.title = activeTab
      ? `${activeTab.dirty ? "● " : ""}${activeTab.name} - NotePP`
      : "NotePP";
  }, [activeTab]);

  // 全局点击关闭右键菜单
  useEffect(() => {
    const hide = () => {
      const menu = document.getElementById("tab-context-menu");
      if (menu) menu.style.display = "none";
    };
    window.addEventListener("click", hide);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("click", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const lang = detectLanguage(activeTab?.path ?? null);
  const lines = activeTab ? activeTab.content.split("\n").length : 0;

  return (
    <div className="app">
      {/* 菜单栏 */}
      <div className="menubar">
        <button onClick={newTab}>新建</button>
        <button onClick={openDialog}>打开</button>
        <button onClick={() => activeTab && saveTab(activeTab)}>保存</button>
        <button onClick={() => activeTab && saveTab(activeTab, true)}>另存为</button>
        <button onClick={() => setDiffDialog(true)}>对比</button>
        <button onClick={() => activeId && closeTab(activeId)}>关闭</button>
        <button
          onClick={toggleRecord}
          className={recording ? "rec-active" : ""}
          title="录制编辑动作 (Ctrl+Shift+R)"
        >
          {recording ? `停止录制 ●${macroLen}` : "录制宏"}
        </button>
        <button
          onClick={replayMacro}
          disabled={recording || macroLen === 0}
          title={`回放宏 (Ctrl+Shift+P)${macroLen ? `，共 ${macroLen} 个动作` : "，尚未录制"}`}
        >
          回放宏
        </button>
        <button
          onClick={() => patchLayout({ sidebarOpen: !layout.sidebarOpen })}
          className={layout.sidebarOpen ? "on" : ""}
          title="显示/隐藏侧栏 (Ctrl+B)"
        >
          侧栏
        </button>
        <button
          onClick={() => patchLayout({ filelistOpen: !layout.filelistOpen })}
          className={layout.filelistOpen ? "on" : ""}
          title="显示/隐藏文件列表 (Ctrl+Shift+B)"
        >
          列表
        </button>
        <button onClick={() => setSettingsOpen(true)} title="编辑器样式设置">
          设置
        </button>
        <button
          onClick={() => setAiSettingsOpen(true)}
          className={aiReady ? "on" : ""}
          title={aiReady ? `AI 已就绪：${resolveConfig(aiConfig).model}` : "配置 AI 服务商与 Key"}
        >
          AI
        </button>
        <span className="spacer" />
        {recent.length > 0 && (
          <select
            className="recent-select"
            value=""
            onChange={(e) => e.target.value && openPath(e.target.value)}
            title="最近打开的文件"
          >
            <option value="">最近文件</option>
            {recent.map((p) => (
              <option key={p} value={p}>
                {baseName(p)} — {p}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        className="workspace"
        style={
          {
            "--sidebar-w": `${layout.sidebarWidth}px`,
            "--filelist-w": `${layout.filelistWidth}px`,
          } as React.CSSProperties
        }
      >
        {layout.sidebarOpen && (
          <Sidebar
            categories={categories}
            files={library}
            activeKey={catKey}
            onSelect={setCatKey}
            onCreate={createCategory}
            onRename={renameCategory}
            onDelete={deleteCategory}
          >
            <FolderTree
              root={folderRoot}
              activePath={activeTab?.path ?? null}
              onOpenFile={openPath}
              onPickFolder={async () => {
                const dir = await openDirectoryDialog();
                if (dir) setFolderRoot(dir);
              }}
              onClear={() => setFolderRoot(null)}
            />
          </Sidebar>
        )}
        {layout.sidebarOpen && (
          <Splitter
            onDelta={(dx) =>
              patchLayout({ sidebarWidth: clampSidebarWidth(layout.sidebarWidth + dx) })
            }
            onReset={() => patchLayout({ sidebarWidth: DEFAULT_LAYOUT.sidebarWidth })}
          />
        )}
        {layout.filelistOpen && (
          <FileList
            title={viewTitle}
            files={viewFiles}
            activePath={activeTab?.path ?? null}
            query={query}
            categories={categories}
            onQuery={setQuery}
            onOpen={openPath}
            onToggleFav={toggleFav}
            onAssign={assignCategory}
            onRemove={removeFromLibrary}
            onNewFile={newTab}
          />
        )}
        {layout.filelistOpen && (
          <Splitter
            onDelta={(dx) =>
              patchLayout({ filelistWidth: clampFilelistWidth(layout.filelistWidth + dx) })
            }
            onReset={() => patchLayout({ filelistWidth: DEFAULT_LAYOUT.filelistWidth })}
          />
        )}

        <div className="main">
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={closeTab}
          />

      <div
        className="editor-area"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
      >
        {diff ? (
          <DiffView
            aText={diff.aText}
            bText={diff.bText}
            aName={diff.aName}
            bName={diff.bName}
            onClose={() => setDiff(null)}
          />
        ) : tabs.length === 0 ? (
          <div className="empty-state">
            <h1>NotePP</h1>
            <p>轻量跨平台文本 / 代码编辑器</p>
            <ul>
              <li><b>Ctrl+N</b> 新建　<b>Ctrl+O</b> 打开　<b>Ctrl+S</b> 保存</li>
              <li><b>Ctrl+F</b> 查找替换　<b>Ctrl+W</b> 关闭标签　<b>Ctrl+Tab</b> 切换标签</li>
              <li>也可以直接把文件拖进窗口</li>
            </ul>
          </div>
        ) : (
          activeTab && (
            <Editor
              key={activeTab.id}
              content={activeTab.content}
              languagePath={activeTab.path}
              onChange={(v) => updateTab(activeTab.id, { content: v, dirty: true })}
              onCursor={(line, col, selected) => setCursor({ line, col, selected })}
              actionSignal={actionSignal}
              settings={editorSettings}
              onZoom={zoomEditor}
              onAiAction={handleAiAction}
              aiReady={aiReady}
              onOpenAiSettings={() => setAiSettingsOpen(true)}
            />
          )
        )}
      </div>

      {activeTab && (
        <StatusBar
          line={cursor.line}
          col={cursor.col}
          selected={cursor.selected}
          lines={lines}
          encoding={activeTab.encoding}
          bom={activeTab.bom}
          eol={activeTab.eol}
          language={lang.name}
          path={activeTab.path}
        />
      )}
        </div>
      </div>

      {/* 未保存确认弹窗 */}
      {confirmState && (
        <div className="modal-mask">
          <div className="modal">
            <p>
              「{tabs.find((t) => t.id === confirmState.tabId)?.name}」有未保存的更改，
              是否保存？
            </p>
            <div className="modal-actions">
              <button
                className="primary"
                onClick={async () => {
                  const tab = tabs.find((t) => t.id === confirmState.tabId);
                  setConfirmState(null);
                  if (tab) {
                    const ok = await saveTab(tab);
                    if (ok) confirmState.onDone();
                  }
                }}
              >
                保存
              </button>
              <button
                onClick={() => {
                  const done = confirmState.onDone;
                  setConfirmState(null);
                  done();
                }}
              >
                不保存
              </button>
              <button onClick={() => setConfirmState(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 文件对比选择对话框 */}
      {diffDialog && (
        <DiffDialog
          tabs={tabs}
          defaultA={activeId}
          onConfirm={startDiff}
          onCancel={() => setDiffDialog(false)}
        />
      )}

      {/* 编辑器设置弹窗 */}
      {settingsOpen && (
        <SettingsDialog
          value={editorSettings}
          onChange={setEditorSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* AI 设置弹窗 */}
      {aiSettingsOpen && (
        <AiSettingsDialog
          config={aiConfig}
          onSave={(c) => {
            setAiConfig(c);
            setAiSettingsOpen(false);
          }}
          onClose={() => setAiSettingsOpen(false)}
        />
      )}

      {/* AI 自定义指令 */}
      {aiCustom && (
        <AiCustomDialog
          source={aiCustom.source}
          onClose={() => setAiCustom(null)}
          onSubmit={(instruction) => {
            const src = aiCustom.source;
            setAiCustom(null);
            void runAi("custom", src, instruction);
          }}
        />
      )}

      {/* AI 结果 */}
      {aiJob && (
        <AiResultDialog
          title={aiJob.title}
          source={aiJob.source}
          loading={aiJob.loading}
          error={aiJob.error}
          result={aiJob.result}
          model={aiJob.model}
          tokens={aiJob.tokens}
          onReplace={(t) => writeAiText("ai-replace", t)}
          onInsert={(t) => writeAiText("ai-insert", t)}
          onClose={() => setAiJob(null)}
          onRetry={() => void runAi(aiJob.action, aiJob.source, aiJob.custom)}
        />
      )}

      {/* 标签右键菜单（简化实现）：点击空白处自动关闭 */}
      <div id="tab-context-menu" className="context-menu">
        <button
          onClick={() => {
            const menu = document.getElementById("tab-context-menu");
            if (menu?.dataset.tabId) closeTab(menu.dataset.tabId);
            menu!.style.display = "none";
          }}
        >
          关闭标签
        </button>
        <button
          onClick={() => {
            const menu = document.getElementById("tab-context-menu");
            if (menu?.dataset.tabId) {
              tabs.filter((t) => t.id !== menu.dataset.tabId).forEach((t) => closeTab(t.id));
            }
            menu!.style.display = "none";
          }}
        >
          关闭其他
        </button>
      </div>
    </div>
  );
}
