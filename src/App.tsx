import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import InsertTableDialog from "./components/InsertTableDialog";
import PreviewDialog from "./components/PreviewDialog";
import FindBar from "./components/FindBar";
import SearchResults from "./components/SearchResults";
import AnnoPanel from "./components/AnnoPanel";
import OutlinePanel, { type OutlineHeading } from "./components/OutlinePanel";
import { countWords } from "./components/StatusBar";
import MacroDialog from "./components/MacroDialog";
import SnippetDialog from "./components/SnippetDialog";
import KeymapDialog from "./components/KeymapDialog";
import ReplacePreviewDialog from "./components/ReplacePreviewDialog";
import {
  addMacro, deleteMacro, exportMacros, importMacros, loadMacros, renameMacro, type SavedMacro,
} from "./lib/macros";
import {
  addSnippet, deleteSnippet, expandSnippet, exportSnippets, importSnippets, loadSnippetBindings,
  saveSnippetBindings, seedSnippetsIfEmpty, updateSnippet, type Snippet,
} from "./lib/snippets";
import {
  BUILTIN_COMMANDS, effectiveKey, loadBindings, normalizeEvent, saveBindings, type Bindings,
} from "./lib/keymap";
import { loadTtsConfig, speak, stopSpeaking } from "./lib/tts";
import { printDocument } from "./lib/print";
import {
  applyCase,
  DEFAULT_OPTIONS,
  findAll,
  lineHitPos,
  lineHits,
  replacePreviews,
  applySelectedReplacements,
  type FolderHitGroup,
  type ReplacePreview,
  type SearchOptions,
} from "./lib/search";
import AiSettingsDialog from "./components/AiSettingsDialog";
import AiResultDialog from "./components/AiResultDialog";
import AiCustomDialog from "./components/AiCustomDialog";
import UpdateDialog from "./components/UpdateDialog";
import { checkUpdate, type UpdateInfo } from "./lib/update";
import {
  AI_ACTIONS,
  friendlyAiError,
  isConfigured,
  isImageReady,
  loadAiConfig,
  resolveConfig,
  runAiActionStream,
  runImageGen,
  saveAiConfig,
  type AiAction,
  type AiConfig,
} from "./lib/ai";
import {
  fileInfo,
  openFileDialog,
  pushRecent,
  readFileChunk,
  readTextFile,
  saveFileDialog,
  writeTextFile,
  getRecent,
  openDirectoryDialog,
  copyMediaFile,
  saveImageB64,
  searchInFolder,
  pathIsDir,
  makeDir,
  renamePath,
  deletePath,
  revealInOS,
  openPathDefault,
  drainOpenedPaths,
  listDir,
  pickMediaDialog,
  dirName,
  mediaRelativeRef,
  type DirEntryInfo,
} from "./lib/files";
import {
  clampFilelistWidth,
  clampSidebarLibH,
  clampSidebarWidth,
  DEFAULT_LAYOUT,
  loadLayout,
  saveLayout,
  type LayoutState,
} from "./lib/layout";
import { clampSettings, effectiveFontSize, loadSettings, saveSettings, UI_SCALE_MAX, UI_SCALE_MIN, ZOOM_STEP, type EditorSettings } from "./lib/settings";
import { maybeAutoBackup } from "./lib/backup";
import { findTheme, themeUiVars } from "./lib/themes";
import {
  loadAnnotations,
  newAnnotationId,
  saveAnnotations,
  type Annotation,
  type AnnotationKind,
} from "./lib/annotations";
import { commentTokens } from "./lib/lang";
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

/** 字节 → 人类可读（大文件模式横幅用） */
function fmtMB(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 超过该大小进入大文件模式（只读 + 分块加载） */
const LARGE_FILE_LIMIT = 8 * 1024 * 1024;
/** 每次加载的字节数 */
const LARGE_FILE_CHUNK = 1024 * 1024;

/** 窄屏（手机/小窗）判定：移动端抽屉行为用 */
function isNarrow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
}

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
    pos?: { from: number; to: number };
  } | null>(null);
  const [diff, setDiff] = useState<{ aText: string; bText: string; aName: string; bName: string } | null>(null);
  const [diffDialog, setDiffDialog] = useState(false);
  const [recording, setRecording] = useState(false);
  const [macroLen, setMacroLen] = useState(0);
  const macroRef = useRef<MacroItem[]>([]);
  const [macroDialogOpen, setMacroDialogOpen] = useState(false);
  const [savedMacros, setSavedMacros] = useState<SavedMacro[]>(() => loadMacros());
  // 片段 / 快捷键 / 替换预览
  const [snippets, setSnippets] = useState<Snippet[]>(() => seedSnippetsIfEmpty());
  const [snippetDialogOpen, setSnippetDialogOpen] = useState(false);
  const [keymapDialogOpen, setKeymapDialogOpen] = useState(false);
  const [keymapFocus, setKeymapFocus] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Bindings>(() => loadBindings());
  const [snippetBindings, setSnippetBindings] = useState<Bindings>(() => loadSnippetBindings());
  const [replacePreviewOpen, setReplacePreviewOpen] = useState(false);
  const [replacePreviewItems, setReplacePreviewItems] = useState<ReplacePreview[]>([]);
  const [pendingReplacement, setPendingReplacement] = useState("");
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

  // 把主题配色 + 界面字号倍率注入到根元素，令整个界面（菜单/侧栏/面板/按钮等）随主题变化
  useEffect(() => {
    const root = document.documentElement;
    const theme = findTheme(editorSettings.theme);
    const vars = themeUiVars(theme);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    // 光标行竖条跟随自定义高亮色（若设置），否则用主题强调色
    root.style.setProperty("--np-linebar", editorSettings.paraColor || vars["--ui-linebar"]);
    // 界面字号倍率：基础 13px → 实际由 CSS calc(13px * var(--ui-scale)) 使用
    root.style.setProperty("--ui-scale", String(editorSettings.uiScale / 100));
    root.style.setProperty("--find-scale", String(editorSettings.findScale / 100));
    // 亮/暗主题标记，供 CSS 做针对性微调
    root.dataset.theme = theme.dark ? "dark" : "light";
  }, [editorSettings.theme, editorSettings.uiScale, editorSettings.findScale, editorSettings.paraColor]);

  // 界面字号快捷键：Ctrl/⌘ + [ / ] 缩放 UI（与编辑器正文缩放独立）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key !== "[" && e.key !== "]") return;
      e.preventDefault();
      const dir = e.key === "]" ? 1 : -1;
      setEditorSettings((s) => {
        const next = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, s.uiScale + dir * 10));
        return { ...s, uiScale: next };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const zoomEditor = useCallback((dir: 1 | -1) => {
    setEditorSettings((s) =>
      clampSettings({ ...s, zoom: s.zoom + dir * ZOOM_STEP })
    );
  }, []);
  const resetZoom = useCallback(() => {
    setEditorSettings((s) => clampSettings({ ...s, zoom: 100 }));
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
    /** v0.28：触发时的文件与选区位置——结果写回原文件原位置（期间切换文件也不丢） */
    target?: { tabId: string | null; pos?: { from: number; to: number } };
  } | null>(null);
  const [aiCustom, setAiCustom] = useState<{ source: string; pos?: { from: number; to: number } } | null>(null);
  /** v0.27：AI 面板收起到后台（不阻塞编辑，状态栏点击恢复） */
  const [aiMin, setAiMin] = useState(false);
  /** v0.28：待写回的 AI 结果（等目标标签激活后经 actionSignal 落到编辑器） */
  const [pendingWrite, setPendingWrite] = useState<{
    mode: "ai-replace" | "ai-insert" | "ai-insert-at";
    text: string;
    tabId: string | null;
    pos?: { from: number; to: number };
  } | null>(null);
  useEffect(() => saveAiConfig(aiConfig), [aiConfig]);
  const aiReady = isConfigured(aiConfig);

  const runAi = useCallback(
    async (action: AiAction, source: string, custom?: string, target?: { tabId: string | null; pos?: { from: number; to: number } }) => {
      const title = AI_ACTIONS.find((a) => a.id === action)?.label ?? "AI 操作";
      setAiMin(false);
      setAiJob({ title, action, source, custom, loading: true, error: null, result: "", target });
      try {
        const res = await runAiActionStream(aiConfig, action, source, custom, (delta) => {
          setAiJob((j) => (j ? { ...j, loading: false, result: (j.result ?? "") + delta } : j));
        });
        setAiJob((j) =>
          j ? { ...j, loading: false, result: res.content || j.result, model: res.model, tokens: res.tokens } : j
        );
      } catch (e) {
        setAiJob((j) =>
          j ? { ...j, loading: false, error: friendlyAiError(e, resolveConfig(aiConfig).model) } : j
        );
      }
    },
    [aiConfig]
  );

  const handleAiAction = useCallback(
    (action: AiAction, text: string, pos?: { from: number; to: number }) => {
      if (!aiReady) {
        setAiSettingsOpen(true);
        return;
      }
      if (action === "custom") {
        setAiCustom({ source: text, pos });
        return;
      }
      // v0.28：记录触发文件与选区位置，AI 完成后写回原处
      void runAi(action, text, undefined, { tabId: activeId, pos });
    },
    [aiReady, runAi, activeId]
  );

  // ---------- 列编辑模式 ----------
  const [columnMode, setColumnMode] = useState(() => localStorage.getItem("notepp.column-mode") === "1");
  useEffect(() => {
    localStorage.setItem("notepp.column-mode", columnMode ? "1" : "0");
  }, [columnMode]);


  // ---------- 更新检查 ----------
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const doCheckUpdate = useCallback(async () => {
    setUpdateChecking(true);
    setUpdateError(null);
    try {
      const info = await checkUpdate();
      setUpdateInfo(info);
    } catch (e) {
      setUpdateError(String(e instanceof Error ? e.message : e));
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  useEffect(() => {
    void doCheckUpdate();
  }, [doCheckUpdate]);

  /** v0.28：AI 结果写回——切回触发时的文件并写回记录的位置（无 target 时按当前选中/光标） */
  const writeAiText = useCallback(
    (mode: "ai-replace" | "ai-insert", text: string) => {
      const t = aiJob?.target;
      setAiJob(null);
      setAiMin(false);
      setPendingWrite({ mode, text, tabId: t?.tabId ?? activeId, pos: t?.pos });
    },
    [aiJob, activeId]
  );

  // pendingWrite：v0.28 直接对目标 tab 的 content 做字符串拼接写回（pos 即文档偏移），
  // 不再经 actionSignal——彻底避开切标签 remount / 信号覆盖竞态；Editor 会经 content prop 自动同步
  useEffect(() => {
    if (!pendingWrite) return;
    const pw = pendingWrite;
    if (pw.tabId && activeId !== pw.tabId) {
      setActiveId(pw.tabId); // v0.28：自动切回触发时的文件
      return;
    }
    const tid = pw.tabId ?? activeId;
    setPendingWrite(null);
    if (!tid) return;
    setTabs((ts) =>
      ts.map((t) => {
        if (t.id !== tid) return t;
        const c = t.content ?? "";
        let next: string;
        if (pw.mode === "ai-replace") {
          const from = Math.max(0, Math.min(pw.pos?.from ?? 0, c.length));
          const to = Math.max(from, Math.min(pw.pos?.to ?? from, c.length));
          next = c.slice(0, from) + pw.text + c.slice(to);
        } else {
          // ai-insert / ai-insert-at：无位置时追加到文末，有位置时插入到光标处
          const at = Math.max(0, Math.min(pw.pos?.from ?? c.length, c.length));
          const nl = at > 0 && at < c.length && c[at - 1] !== "\n" && !pw.text.startsWith("\n") ? "\n" : "";
          next = c.slice(0, at) + nl + pw.text + c.slice(at);
        }
        return { ...t, content: next, dirty: true };
      })
    );
  }, [pendingWrite, activeId]);

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

  // ---------- 查找替换（当前文件 + 跨文件夹） ----------
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findOptions, setFindOptions] = useState<SearchOptions>(DEFAULT_OPTIONS);
  const [findSeed, setFindSeed] = useState("");
  const [findCurrent, setFindCurrent] = useState(0);
  const [gotoRequest, setGotoRequest] = useState<{ n: number; from: number; to: number } | null>(null);
  const [folderHits, setFolderHits] = useState<FolderHitGroup[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  /** 替换结果轻提示（如「已替换 12 处」） */
  const [replaceMsg, setReplaceMsg] = useState<string | null>(null);
  const gotoSeq = useRef(0);

  /** 当前文件的全部匹配（面板计数与跳转共用） */
  const findMatches = useMemo(
    () => (activeTab ? findAll(activeTab.content, findQuery, findOptions) : []),
    [activeTab?.content, findQuery, findOptions]
  );

  /** 搜索高亮（当前命中单独标色） */
  const searchMarks = useMemo(
    () => findMatches.map((m, i) => ({ ...m, current: i === findCurrent })),
    [findMatches, findCurrent]
  );

  // ---------- 搜索结果面板（Notepad++ 风格：行号+行内容+点击跳行） ----------
  const [resultsOpen, setResultsOpen] = useState(false);
  /** 命中按行聚合（结果面板数据源） */
  const searchLineHits = useMemo(
    () => (activeTab ? lineHits(activeTab.content, findMatches) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab?.content, findMatches]
  );
  /** 当前命中所在行（面板中加粗定位） */
  const currentMatchLine = useMemo(() => {
    const m = findMatches[findCurrent];
    if (!m || !activeTab) return null;
    return activeTab.content.slice(0, m.from).split("\n").length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findMatches, findCurrent, activeTab?.content]);

  /** 当前查找位置的位置指针；null 表示还没跳过（下次跳第一处） */
  const findPosRef = useRef<number | null>(null);
  /** 当前序号（与 findCurrent 同步，供 stepFind 读取最新值） */
  const findCurrentRef = useRef(-1);

  const gotoMatch = useCallback(
    (idx: number) => {
      const m = findMatches[idx];
      if (!m) return;
      findCurrentRef.current = idx;
      setFindCurrent(idx);
      findPosRef.current = m.from;
      gotoSeq.current += 1;
      setGotoRequest({ n: gotoSeq.current, from: m.from, to: m.to });
    },
    [findMatches]
  );

  // 查询/选项真正变化时才重置指针与序号（不能在每次重渲染里重置，否则跳转会被打回第一处）
  const findKeyRef = useRef("");
  useEffect(() => {
    if (!findOpen) return;
    const key = `${findQuery}\u0000${findOptions.caseSensitive}${findOptions.wholeWord}${findOptions.regex}`;
    if (findKeyRef.current === key) return;
    findKeyRef.current = key;
    findPosRef.current = null;
    findCurrentRef.current = -1;
    setFindCurrent(0);
    // 输入即预览：把光标移到第一处命中，并把「当前位置」记到第一处，
    // 这样下一次「下一处」是第 2 处，而不是原地不动。
    const first = findMatches[0];
    if (first) {
      findCurrentRef.current = 0;
      findPosRef.current = first.from;
      gotoSeq.current += 1;
      setGotoRequest({ n: gotoSeq.current, from: first.from, to: first.to });
    } else {
      setGotoRequest(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, findOptions, findMatches, findOpen]);

  const stepFind = useCallback(
    (dir: 1 | -1) => {
      if (findMatches.length === 0) return;
      const cur = findCurrentRef.current;
      // 还没跳过（-1）→ 正向从第一处开始；反向从最后一处开始
      const target =
        cur < 0 || cur >= findMatches.length
          ? dir === 1
            ? 0
            : findMatches.length - 1
          : (cur + dir + findMatches.length) % findMatches.length;
      gotoMatch(target);
    },
    [findMatches, gotoMatch]
  );

  /** 点击结果面板某行 → 跳到该行第一个命中 */
  const jumpToResultLine = useCallback(
    (line: number) => {
      if (!activeTab) return;
      const pos = lineHitPos(activeTab.content, line);
      let idx = findMatches.findIndex((m) => m.from >= pos);
      if (idx < 0) idx = 0;
      gotoMatch(idx);
    },
    [activeTab, findMatches, gotoMatch]
  );

  /** 替换当前命中 */
  const doReplace = useCallback(
    (replacement: string) => {
      if (!activeTab || findMatches.length === 0) return;
      const idx = findCurrent >= 0 && findCurrent < findMatches.length ? findCurrent : 0;
      const m = findMatches[idx];
      const piece = applyCase(activeTab.content.slice(m.from, m.to), replacement, findOptions);
      const next = activeTab.content.slice(0, m.from) + piece + activeTab.content.slice(m.to);
      updateTab(activeTab.id, { content: next, dirty: true });
      // 替换后光标停在替换文本末尾，再跳到下一处
      gotoSeq.current += 1;
      setGotoRequest({ n: gotoSeq.current, from: m.from + piece.length, to: m.from + piece.length });
      findCurrentRef.current = idx;
      setFindCurrent(idx);
    },
    [activeTab, findMatches, findCurrent, findOptions, updateTab]
  );

  /** 真正执行「全部替换」（由预览弹窗确认后调用） */
  const applyReplacement = useCallback(
    (text: string, count: number) => {
      if (!activeTab) return;
      updateTab(activeTab.id, { content: text, dirty: true });
      setFindCurrent(0);
      findCurrentRef.current = -1;
      findPosRef.current = null;
      setReplaceMsg(`已替换 ${count} 处`);
      window.setTimeout(() => setReplaceMsg(null), 4000);
    },
    [activeTab, updateTab]
  );

  /** 打开替换预览：先算逐条 diff，让用户确认后再执行 */
  const doReplaceAll = useCallback(
    (replacement: string) => {
      if (!activeTab || findMatches.length === 0) return;
      const previews = replacePreviews(activeTab.content, findQuery, replacement, findOptions);
      if (previews.length === 0) return;
      setReplacePreviewItems(previews);
      setPendingReplacement(replacement);
      setReplacePreviewOpen(true);
    },
    [activeTab, findMatches.length, findQuery, findOptions]
  );

  /** 预览弹窗确认：按勾选执行替换 */
  const confirmReplace = useCallback(
    (picked: ReplacePreview[]) => {
      if (!activeTab || picked.length === 0) { setReplacePreviewOpen(false); return; }
      const { text, count } = applySelectedReplacements(activeTab.content, picked);
      applyReplacement(text, count);
      setReplacePreviewOpen(false);
    },
    [activeTab, applyReplacement]
  );

  /** 在文件夹中查找 */
  const doFolderSearch = useCallback(
    async (q: string, opt: SearchOptions) => {
      if (!folderRoot || !q) return;
      setFolderLoading(true);
      setFolderMessage(null);
      try {
        const hits = await searchInFolder(folderRoot, q, opt);
        const map = new Map<string, FolderHitGroup>();
        for (const h of hits) {
          const g = map.get(h.path) ?? { path: h.path, name: baseName(h.path), hits: [] };
          g.hits.push(h);
          map.set(h.path, g);
        }
        setFolderHits([...map.values()]);
        setFolderMessage(hits.length === 0 ? "没有匹配结果" : null);
      } catch (e) {
        setFolderHits([]);
        setFolderMessage(String(e instanceof Error ? e.message : e));
      } finally {
        setFolderLoading(false);
      }
    },
    [folderRoot]
  );

  /** 所有已打开标签中查找（内存搜索，不改底部结果面板） */
  const [tabHits, setTabHits] = useState<FolderHitGroup[]>([]);
  const [tabMessage, setTabMessage] = useState<string | null>(null);
  const doTabsSearch = useCallback(
    (q: string, opt: SearchOptions) => {
      if (!q) return;
      const groups: FolderHitGroup[] = [];
      for (const t of tabsRef.current) {
        if (t.large) continue;
        const matches = findAll(t.content, q, opt);
        if (matches.length === 0) continue;
        const key = t.path ?? `tab:${t.id}`;
        groups.push({
          path: key,
          name: t.path ? baseName(t.path) : `未保存 - ${t.name}`,
          hits: lineHits(t.content, matches).map((h) => ({
            path: key,
            line: h.line,
            text: h.text,
            col: h.ranges[0]?.start ?? 0,
          })),
        });
      }
      setTabHits(groups);
      setTabMessage(groups.length === 0 ? "已打开的标签中没有匹配结果" : null);
    },
    []
  );

  /** 打开文件夹搜索结果：打开文件并跳到对应行；标签结果则直接切换标签 */
  const openFolderHit = useCallback(
    async (path: string, line: number) => {
      if (path.startsWith("tab:")) {
        const id = path.slice(4);
        setActiveId(id);
        window.setTimeout(() => {
          setActionSignal({ type: "goto-line", n: ++actionCount.current, text: String(line) });
        }, 200);
        return;
      }
      await openPathRef.current(path);
      // 等标签挂载后跳到该行
      window.setTimeout(() => {
        setActionSignal({ type: "goto-line", n: ++actionCount.current, text: String(line) });
      }, 250);
    },
    []
  );

  /** openPath 的引用（避免循环依赖，供 openFolderHit 使用） */
  const openPathRef = useRef<(p: string) => Promise<void>>(async () => {});

  /** 编辑器当前选中文本（Ctrl/F 自动带入用；CodeMirror 状态来源，比 DOM selection 可靠） */
  const selectionTextRef = useRef("");
  /** 当前编辑器光标偏移（AI/生图触发时记录位置用，v0.28） */
  const cursorHeadRef = useRef<number | null>(null);

  /** 打开查找栏（带入选中文本） */
  const openFind = useCallback(() => {
    const cmSel = selectionTextRef.current.trim();
    const sel = cmSel || (window.getSelection()?.toString() ?? "");
    setFindSeed(sel.length > 0 && sel.length < 300 ? sel : "");
    setFindOpen(true);
  }, []);

  /** 打开查找栏并填入指定关键词（右键「在 NotePP 中搜索」用） */
  const openFindWith = useCallback((text: string) => {
    const kw = text.trim().slice(0, 300);
    setFindSeed(kw);
    setFindOpen(true);
  }, []);

  /** 右键「在 Web 搜索」：按设置的引擎用系统浏览器打开搜索页 */
  const handleWebSearch = useCallback(
    (text: string) => {
      const kw = encodeURIComponent(text.trim());
      if (!kw) return;
      const engine = editorSettings.webSearch;
      const url =
        engine === "google"
          ? `https://www.google.com/search?q=${kw}`
          : engine === "baidu"
            ? `https://www.baidu.com/s?wd=${kw}`
            : engine === "duckduckgo"
              ? `https://duckduckgo.com/?q=${kw}`
              : `https://www.bing.com/search?q=${kw}`;
      openUrl(url).catch((e) => alert(`打开浏览器失败：${e}`));
    },
    [editorSettings.webSearch]
  );


  // ---------- 标注（划线/高亮/备注，按文件路径持久化） ----------
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const activePath = activeTab?.path ?? null;
  useEffect(() => {
    setAnnotations(activePath ? loadAnnotations(activePath) : []);
  }, [activePath]);

  const persistAnnotations = useCallback((list: Annotation[]) => {
    setAnnotations(list);
    if (activePath) saveAnnotations(activePath, list);
  }, [activePath]);

  const handleAnnotate = useCallback(
    (a: { from: number; to: number; text: string; kind: AnnotationKind; color?: string; note?: string }) => {
      const ann: Annotation = { id: newAnnotationId(), createdAt: Date.now(), ...a };
      setAnnotations((prev) => {
        const next = [...prev, ann];
        if (activePath) saveAnnotations(activePath, next);
        return next;
      });
    },
    [activePath]
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      setAnnotations((prev) => {
        const next = prev.filter((x) => x.id !== id);
        if (activePath) saveAnnotations(activePath, next);
        return next;
      });
    },
    [activePath]
  );

  /** 朗读标注文本（先停止上一次朗读） */
  const handleAnnoSpeak = useCallback(async (text: string) => {
    try {
      stopSpeaking();
      await speak(text, loadTtsConfig());
    } catch (e) {
      alert(`朗读失败：${e instanceof Error ? e.message : e}`);
    }
  }, []);

  /** 复制标注文本到剪贴板 */
  const handleAnnoCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 兜底：老 WebView 不支持 async clipboard
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }, []);


  // ---------- 标注导航面板 ----------
  const [annoOpen, setAnnoOpen] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);
  /** 点击标注列表项 → 跳到标注位置 */
  const jumpToAnnotation = useCallback((ann: Annotation) => {
    gotoSeq.current += 1;
    setGotoRequest({ n: gotoSeq.current, from: ann.from, to: ann.to });
  }, []);

  // ---------- v0.23 大纲/目录面板（Markdown 标题，不限扩展名） ----------
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outline = useMemo<OutlineHeading[]>(() => {
    if (!activeTab) return [];
    const out: OutlineHeading[] = [];
    let inCode = false;
    const lines = activeTab.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*(```|~~~)/.test(l)) inCode = !inCode; // 跳过代码块
      if (inCode) continue;
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, ""), line: i + 1 });
    }
    return out;
  }, [activeTab?.id, activeTab?.content]);
  const jumpToOutline = useCallback((line: number) => {
    setActionSignal({ type: "goto-line", n: ++actionCount.current, text: String(line) });
  }, []);

  // ---------- v0.23 光标位置记忆（下次打开同一文件回到上次行号） ----------
  const cursorPosKey = "notepp.cursor-pos";
  // 未保存草稿（无路径标签）的光标：会话内按标签 id 记内存，重启时随草稿持久化
  const draftCursorRef = useRef<Map<string, { line: number; col: number }>>(new Map());
  const saveCursorPos = useCallback((path: string, line: number, col: number) => {
    try {
      const all = JSON.parse(localStorage.getItem(cursorPosKey) ?? "{}");
      const cur = all[path];
      if (cur && cur.line === line && cur.col === col) return;
      all[path] = { line, col };
      localStorage.setItem(cursorPosKey, JSON.stringify(all));
    } catch { /* ignore */ }
  }, []);
  const loadCursorPos = useCallback((path: string): { line: number; col: number } | null => {
    try {
      const all = JSON.parse(localStorage.getItem(cursorPosKey) ?? "{}");
      const c = all[path];
      return c && Number.isFinite(c.line) && c.line >= 1 ? c : null;
    } catch { return null; }
  }, []);
  // 切换标签时恢复该文件的光标位置（多文件固有行为：每个标签停在各自上次的位置；
  // 未保存草稿同样适用——按标签 id 从内存恢复）
  // v0.28：dispatch 延后一拍——避免与 pendingWrite（AI 写回切标签）在同一批 effects 里
  // setActionSignal 相互覆盖（同为一次性信号 state，后写获胜）
  useEffect(() => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return;
    const saved = t.path ? loadCursorPos(t.path) : draftCursorRef.current.get(t.id) ?? null;
    if (!saved) return;
    const timer = window.setTimeout(() => jumpToOutline(saved.line), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ---------- 插入表格 / Markdown 预览 ----------
  const [tableOpen, setTableOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const insertText = useCallback((text: string) => {
    actionCount.current += 1;
    setActionSignal({ type: "insert-text", n: actionCount.current, text });
  }, []);

  /** 插入当前日期时间 / 日期 / 时间 */
  const insertDateTime = useCallback((mode: "datetime" | "date" | "time") => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const d = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const t = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    insertText(mode === "date" ? d : mode === "time" ? t : `${d} ${t}`);
  }, [insertText]);

  /** 按当前文件类型插入注释 */
  const insertComment = useCallback((block = false) => {
    const tok = commentTokens(activeTab?.path ?? activeTab?.name ?? null);
    insertText(block ? `${tok.blockStart}注释内容${tok.blockEnd}` : `${tok.line}注释内容${tok.lineEnd ?? ""}`);
  }, [insertText, activeTab]);

  /** 文字变换：upper / lower / title / sort / sort-desc / dedupe / trim */
  const runTransform = useCallback((kind: string) => {
    actionCount.current += 1;
    setActionSignal({ type: "transform", n: actionCount.current, text: kind });
  }, []);
  /** 把标注文本粘贴（插入）到当前光标处 */
  const handleAnnoPaste = useCallback(
    (text: string) => {
      insertText(text);
    },
    [insertText]
  );

  const activeIsMarkdown = !!activeTab && (/\.(md|markdown)$/i.test(activeTab.name) || /\.(md|markdown)$/i.test(activeTab.path ?? ""));
  void activeIsMarkdown; // 预览按钮对所有文档开放；保留标记供状态提示使用

  const exportPreviewHtml = useCallback(async (html: string) => {
    const name = (activeTab?.name ?? "文档").replace(/\.[^.]+$/, "") + ".html";
    const picked = await saveFileDialog(name);
    if (!picked) return;
    try {
      await writeTextFile({ path: picked, content: html, encoding: "UTF-8", bom: false, eol: "LF" });
      pushRecent(picked);
      setRecent(getRecent());
    } catch (e) {
      alert(`导出失败：${e}`);
    }
  }, [activeTab]);

  /** 打印 / 导出 PDF（打印机选「另存为 PDF」） */
  const doPrint = useCallback(() => {
    if (!activeTab) return;
    printDocument(
      activeTab.content,
      activeTab.name.replace(/\.[^.]+$/, ""),
      effectiveFontSize(editorSettings),
      /\.(md|markdown|txt)$/i.test(activeTab.name),
      activeTab.path ? dirName(activeTab.path) : null
    );
  }, [activeTab, editorSettings]);

  // ---------- 分屏对照（左右同时查看两个文件） ----------
  const [splitId, setSplitId] = useState<string | null>(null);
  const splitTab = useMemo(() => tabs.find((t) => t.id === splitId) ?? null, [tabs, splitId]);
  const toggleSplit = useCallback(() => {
    if (splitId) {
      setSplitId(null);
      return;
    }
    const other = tabs.find((t) => t.id !== activeId);
    if (!other) {
      alert("分屏需要至少两个文件：请再打开一个文件后重试。");
      return;
    }
    setSplitId(other.id);
  }, [splitId, tabs, activeId]);

  // ---------- 拖拽多媒体/附件（引用插入） ----------
  /** 判断路径是否在文件夹树根目录之下（保存/媒体归档后决定是否刷新树） */
  const isUnderFolderRoot = useCallback((p: string, r: string | null): boolean => {
    if (!r || !p) return false;
    const norm = (x: string) => x.replace(/[\\/]+$/, "").toLowerCase();
    const rr = norm(r);
    const f = norm(p);
    if (f === rr) return true;
    return f.startsWith(rr) && (f[rr.length] === "/" || f[rr.length] === "\\");
  }, []);
  const MEDIA_IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"]);
  const MEDIA_AUDIO = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);
  const MEDIA_VIDEO = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);

  const insertMedia = useCallback(
    async (srcPath: string) => {
      if (!activeTab) {
        alert("请先新建或打开一个文档，再插入媒体/附件。");
        return;
      }
      if (!activeTab.path) {
        alert(
          editorSettings.mediaMode === "copy"
            ? "文档尚未保存。请先用 Ctrl+S 保存文档，媒体文件会复制到文档同目录的 media/ 文件夹下并以引用方式插入。"
            : "文档尚未保存。请先用 Ctrl+S 保存文档，才能按相对路径引用媒体文件。"
        );
        return;
      }
      if (activeTab.readOnly) {
        alert("大文件模式为只读，不支持插入媒体引用。");
        return;
      }
      const file = baseName(srcPath);
      const ext = (file.split(".").pop() ?? "").toLowerCase();
      const stem = file.replace(/\.[^.]+$/, "");
      try {
        // 归档策略：copy=复制到文档旁 media/；relative=直接相对路径引用原位置
        const rel =
          editorSettings.mediaMode === "copy"
            ? await copyMediaFile(srcPath, activeTab.path)
            : mediaRelativeRef(srcPath, activeTab.path);
        // media/ 目录可能新建 → 刷新文件夹树
        if (editorSettings.mediaMode === "copy" && folderRoot && isUnderFolderRoot(activeTab.path, folderRoot))
          setFolderReloadKey((k) => k + 1);
        let snippet: string;
        if (MEDIA_IMG.has(ext)) snippet = `![${stem}](${rel})`;
        else if (MEDIA_AUDIO.has(ext)) snippet = `\n<audio controls src="${rel}"></audio>\n`;
        else if (MEDIA_VIDEO.has(ext)) snippet = `\n<video controls width="480" src="${rel}"></video>\n`;
        else snippet = `\n[📎 ${file}](${rel})\n`;
        insertText(snippet);
      } catch (e) {
        alert(`插入媒体失败：${e}`);
      }
    },
    [activeTab, insertText, editorSettings.mediaMode, folderRoot, isUnderFolderRoot]
  );

  /** 菜单/右键插入：打开文件选择框（可多选），逐个按归档策略插入 */
  const pickAndInsertMedia = useCallback(async () => {
    const paths = await pickMediaDialog();
    if (!paths || paths.length === 0) return;
    for (const p of paths) await insertMedia(p);
  }, [insertMedia]);

  // ---------- AI 生图（v0.19；v0.24 改对话框；v0.27 后台生成：点生成立即关窗继续编辑，完成后自动插入并在状态栏提示） ----------
  const aiImgReady = isImageReady(aiConfig);
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgPromptOpen, setImgPromptOpen] = useState(false);
  const [imgPromptText, setImgPromptText] = useState("");
  const [imgDone, setImgDone] = useState<string | null>(null);
  const handleImageGen = useCallback(async () => {
    if (!activeTab) return;
    if (activeTab.readOnly) {
      alert("大文件模式为只读，不支持插入生成的图片。");
      return;
    }
    if (!aiImgReady) {
      alert("尚未配置 AI 生图：请先在「AI 设置」中填写 API 地址、Key 与生图模型。");
      setAiSettingsOpen(true);
      return;
    }
    setImgErr(null);
    // v0.25：提示词优先用当前选中的文字
    setImgPromptText(selectionTextRef.current?.trim() ?? "");
    setImgPromptOpen(true);
  }, [activeTab, aiImgReady]);

  const [imgErr, setImgErr] = useState<string | null>(null);
  const doImageGen = useCallback(async () => {
    const desc = imgPromptText.trim();
    if (!desc) {
      setImgErr("请先输入图片描述（提示词），例如：赛博朋克风格的城市夜景，霓虹灯，雨夜");
      return;
    }
    if (!activeTab?.path) {
      setImgErr("生成的图片要保存到文档旁 media/ 目录，当前文档尚未保存。\n请先用 Ctrl+S 保存文档，再生成。");
      return;
    }
    // v0.28：记住触发的文件与光标位置——生成期间切换文件，完成后仍插回原处
    const targetTabId = activeId;
    const targetHead = cursorHeadRef.current;
    setImgGenerating(true);
    setImgErr(null);
    setImgDone(null);
    setImgPromptOpen(false); // v0.27：点生成立即关闭对话框，生成在后台进行，期间可正常编辑/浏览
    try {
      const urls = await runImageGen(aiConfig, desc, 1);
      if (urls.length === 0) throw new Error("API 未返回图片");
      let url = urls[0];
      // v0.25：base64/dataURL 不再直接塞进文档——解码落盘到文档旁 media/，插入相对引用
      if (url.startsWith("data:")) {
        if (activeTab.readOnly) throw new Error("大文件模式为只读，无法保存生成的图片。");
        const m = /^data:image\/([a-z0-9+]+);base64,(.+)$/i.exec(url);
        const ext = m?.[1]?.replace("jpeg", "jpg") ?? "png";
        const b64 = m?.[2] ?? url;
        url = await saveImageB64(activeTab.path, b64, ext);
        // media/ 目录可能新建 → 刷新文件夹树
        if (folderRoot && isUnderFolderRoot(activeTab.path, folderRoot)) setFolderReloadKey((k) => k + 1);
      }
      // v0.27：方括号（alt 文本）改用英文标识符 ai-image-时间戳，
      // 中文提示词不再进入引用，避免长描述/特殊字符破坏 Markdown 链接
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      const snippet = `\n![ai-image-${stamp}](${url})\n`;
      // v0.28：经 pendingWrite 写回记录的文件与位置（期间切换了文件也能插回原处）
      setPendingWrite({
        mode: "ai-insert-at",
        text: snippet,
        tabId: targetTabId,
        pos: { from: targetHead ?? 0, to: targetHead ?? 0 },
      });
      setImgDone("图片已插入到光标处");
      window.setTimeout(() => setImgDone(null), 6000);
    } catch (e) {
      setImgErr(friendlyAiError(e, resolveConfig(aiConfig).imgModel));
    } finally {
      setImgGenerating(false);
    }
  }, [imgPromptText, aiConfig, insertText, activeTab, activeId, folderRoot, isUnderFolderRoot]);

  // v0.27：AI/生图任务在状态栏的汇总提示（不阻塞编辑，点击回到面板）
  const aiStatusPill: { state: "running" | "done" | "error"; label: string } | null = useMemo(() => {
    if (imgGenerating) return { state: "running", label: "生图生成中…" };
    if (imgErr) return { state: "error", label: "生图失败·点击查看" };
    if (imgDone) return { state: "done", label: `🎨 ${imgDone}` };
    if (aiJob) {
      if (aiJob.loading) return { state: "running", label: `✨ ${aiJob.title}运行中…` };
      if (aiMin) return { state: aiJob.error ? "error" : "done", label: `✨ ${aiJob.title}${aiJob.error ? "出错·点击查看" : "结果就绪·点击查看"}` };
    }
    return null;
  }, [imgGenerating, imgErr, imgDone, aiJob, aiMin]);

  const onAiStatusClick = useCallback(() => {
    if (imgGenerating || imgErr || imgDone) {
      setImgPromptOpen(true);
      return;
    }
    if (aiJob) setAiMin(false);
  }, [imgGenerating, imgErr, imgDone, aiJob]);

  /** 判断拖入路径是当文本打开，还是作为媒体/附件插入引用 */
  const isTextFilePath = (p: string): boolean => {
    const ext = (p.split(/[\\/]/).pop()?.split(".").pop() ?? "").toLowerCase();
    if (MEDIA_IMG.has(ext) || MEDIA_AUDIO.has(ext) || MEDIA_VIDEO.has(ext)) return false;
    // 其余一律按文本尝试（v0.22.3：ini/cfg/csv/toml 等文件关联注册的扩展此前被误拦）
    return true;
  };



  /** 打开单个路径（去重：已打开则激活） */
  const openPath = useCallback(async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    try {
      const { size } = await fileInfo(path);
      if (size > LARGE_FILE_LIMIT) {
        const first = await readFileChunk(path, 0, LARGE_FILE_CHUNK);
        pushRecent(path);
        setRecent(getRecent());
        setLibrary((prev) => upsertFile(prev, path, first));
        const tab: FileTab = {
          id: newId(),
          path,
          name: `${baseName(path)}（大文件）`,
          content: first,
          dirty: false,
          encoding: "UTF-8",
          bom: false,
          eol: "LF",
          readOnly: true,
          large: { total: size, loaded: Math.min(size, LARGE_FILE_CHUNK) },
        };
        setTabs((ts) => [...ts, tab]);
        setActiveId(tab.id);
        return;
      }
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

  // openPath 就绪后写入 ref，供文件夹搜索结果跳转使用
  useEffect(() => {
    openPathRef.current = openPath;
  }, [openPath]);

  // ---------- 文件夹树：本地文件操作（v0.15） ----------
  const [folderReloadKey, setFolderReloadKey] = useState(0);

  const joinPath = (dir: string, name: string): string => {
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return (dir.endsWith("/") || dir.endsWith("\\") ? dir : `${dir}${sep}`) + name;
  };

  /** 在指定目录新建文件（支持模板后缀：.txt/.md/.json/.log） */
  const createFileIn = useCallback(async (dir: string) => {
    const name = window.prompt("新建文件名（后缀决定模板：.txt / .md / .json / .log）", "未命名.txt");
    if (!name || !name.trim()) return;
    const path = joinPath(dir, name.trim());
    const tpl = name.endsWith(".md")
      ? `# ${name.replace(/\.md$/i, "")}\n\n`
      : name.endsWith(".json")
        ? "{\n  \n}\n"
        : "";
    try {
      await writeTextFile({ path, content: tpl, encoding: "UTF-8", bom: false, eol: "LF" });
      setFolderReloadKey((k) => k + 1);
      await openPath(path);
    } catch (e) {
      alert(`新建文件失败：${e}`);
    }
  }, [openPath]);

  /** 在指定目录新建文件夹 */
  const createFolderIn = useCallback(async (dir: string) => {
    const name = window.prompt("新建文件夹名", "新建文件夹");
    if (!name || !name.trim()) return;
    try {
      await makeDir(joinPath(dir, name.trim()));
      setFolderReloadKey((k) => k + 1);
    } catch (e) {
      alert(`新建文件夹失败：${e}`);
    }
  }, []);

  /** 重命名（打开中的同名标签同步改名） */
  const renameTreePath = useCallback(async (p: string) => {
    const cur = p.split(/[\\/]/).pop() ?? p;
    const newName = window.prompt("重命名为", cur);
    if (!newName || !newName.trim() || newName.trim() === cur) return;
    const parent = p.slice(0, p.length - cur.length - 1);
    const to = joinPath(parent, newName.trim());
    try {
      await renamePath(p, to);
      setFolderReloadKey((k) => k + 1);
      setTabs((ts) =>
        ts.map((t) =>
          t.path === p
            ? { ...t, path: to, name: newName.trim() }
            : t.path && t.path.startsWith(`${p}/`) || t.path?.startsWith(`${p}\\`)
              ? { ...t, path: to + t.path.slice(p.length) }
              : t
        )
      );
    } catch (e) {
      alert(`重命名失败：${e}`);
    }
  }, []);

  /** 在系统文件管理器中定位 */
  /** 在系统中显示（文件管理器里定位） */
  const revealTreePath = useCallback(async (p: string) => {
    if (!p) return;
    try {
      await revealInOS(p);
    } catch (e) {
      alert(`定位失败：${e}`);
    }
  }, []);

  /** 取路径的父目录（兼容 / 与 \） */
  const dirnameOf = useCallback((p: string) => {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i > 0 ? p.slice(0, i) : p;
  }, []);

  /** 打开某文件/目录所在的文件夹（设为侧栏目录树根） */
  const openFolderOf = useCallback((p: string | null | undefined) => {
    if (!p) return;
    const dir = dirnameOf(p);
    if (dir) setFolderRoot(dir);
  }, [dirnameOf]);

  /** 递归收集目录下的文本文件（上限 200，深度 5） */
  const collectTextFiles = async (dir: string, acc: string[], depth = 0): Promise<string[]> => {
    if (depth > 5 || acc.length >= 200) return acc;
    let es: DirEntryInfo[] = [];
    try {
      es = await listDir(dir);
    } catch {
      return acc;
    }
    for (const e of es) {
      if (acc.length >= 200) break;
      if (e.is_dir) await collectTextFiles(e.path, acc, depth + 1);
      else if (isTextFilePath(e.path)) acc.push(e.path);
    }
    return acc;
  };

  /** 一键打开目录下所有文本文件 */
  const openAllInDir = useCallback(async (dir: string) => {
    const files = await collectTextFiles(dir, []);
    if (files.length === 0) {
      setTabMessage("该文件夹里没有找到文本文件");
      return;
    }
    if (files.length > 20 && !window.confirm(`共找到 ${files.length} 个文本文件，全部打开？`)) return;
    for (const f of files) await openPathRef.current(f);
    setTabMessage(`已打开 ${files.length} 个文件`);
  }, [setTabMessage]);

  /** 处理系统传入的路径（文件关联/单实例/argv/macOS Opened）：目录→打开文件夹，文本→开标签 */
  const handleSystemPaths = useCallback(async (paths: string[]) => {
    for (const p of paths) {
      let isDir = false;
      try {
        isDir = (await pathIsDir(p)) === true;
      } catch {
        /* 非桌面环境忽略 */
      }
      if (isDir) {
        setFolderRoot(p);
        continue;
      }
      if (isTextFilePath(p)) {
        await openPathRef.current(p);
      } else {
        setTabMessage(`已忽略非文本路径：${p.split(/[\\/]/).pop()}`);
      }
    }
  }, [setTabMessage]);

  // 系统传入路径：启动时 drain 一次（冷启动竞态兜底）+ 运行中监听 open-files 事件
  const handleSystemPathsRef = useRef(handleSystemPaths);
  useEffect(() => {
    handleSystemPathsRef.current = handleSystemPaths;
  }, [handleSystemPaths]);
  const drainedRef = useRef(false);
  useEffect(() => {
    if (!drainedRef.current) {
      drainedRef.current = true;
      void (async () => {
        try {
          const paths = await drainOpenedPaths();
          if (paths.length) await handleSystemPathsRef.current(paths);
        } catch {
          /* 浏览器环境无此命令 */
        }
      })();
    }
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string[]>("open-files", (e) => {
          void handleSystemPathsRef.current(e.payload ?? []);
        })
      )
      .then((fn) => {
        unlisten = fn ?? null;
      })
      .catch(() => {
        /* 浏览器/测试环境 */
      });
    return () => {
      try {
        unlisten?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  /** 大文件模式：追加下一块 */
  const loadMoreChunk = useCallback(async () => {
    const t = activeTab;
    if (!t?.large || !t.path) return;
    try {
      const step = Math.min(LARGE_FILE_CHUNK, t.large.total - t.large.loaded);
      const next = await readFileChunk(t.path, t.large.loaded, step);
      updateTab(t.id, {
        content: t.content + next,
        large: { total: t.large.total, loaded: t.large.loaded + step },
      });
    } catch (e) {
      alert(`加载失败：${e}`);
    }
  }, [activeTab, updateTab]);

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
      let session: { paths: string[]; activePath: string | null; drafts?: { path: string | null; name: string; content: string; cursor?: { line: number; col: number } }[] } | null = null;
      try {
        session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
      } catch {
        session = null;
      }
      const paths = session?.paths ?? [];
      const drafts: { path: string | null; name: string; content: string; cursor?: { line: number; col: number } }[] = Array.isArray(session?.drafts)
        ? session.drafts
        : [];
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
      // 草稿恢复：未保存的新文件 / 已保存但未保存的修改
      for (const d of drafts) {
        if (!d || typeof d.content !== "string") continue;
        if (d.path) {
          const t = loaded.find((x) => x.path === d.path);
          if (t && d.content !== t.content) {
            t.content = d.content;
            t.dirty = true;
          }
        } else {
          const tab: FileTab = {
            id: newId(),
            path: null,
            name: d.name || "未命名",
            content: d.content,
            dirty: true,
            encoding: "UTF-8",
            bom: false,
            eol: "LF",
          };
          // 草稿自带光标 → 种回内存 Map，激活该标签时自动恢复
          if (d.cursor && Number.isFinite(d.cursor.line) && d.cursor.line >= 1) {
            draftCursorRef.current.set(tab.id, { line: d.cursor.line, col: d.cursor.col ?? 1 });
          }
          loaded.push(tab);
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

  // ---------- 会话持久化：标签变化时保存路径列表 + 未保存草稿 ----------
  useEffect(() => {
    if (!sessionLoaded.current) return;
    const paths = tabs.filter((t) => t.path).map((t) => t.path!);
    const activePath = tabs.find((t) => t.id === activeId && t.path)?.path ?? null;
    // 草稿：未保存的新文件 + 已保存但有未落盘修改的标签（单个上限 500KB，总量上限约 4MB）
    const DRAFT_MAX = 500_000;
    let drafts = tabs
      .filter((t) => !t.readOnly && (!t.path || t.dirty) && t.content.length > 0 && t.content.length <= DRAFT_MAX)
      .map((t) => {
        const cur = t.path ? loadCursorPos(t.path) : draftCursorRef.current.get(t.id) ?? undefined;
        return { path: t.path ?? null, name: t.name, content: t.content, cursor: cur };
      });
    const payload = JSON.stringify({ paths, activePath, drafts });
    if (payload.length > 4_000_000) drafts = []; // 超限只保路径，保证设置不爆 localStorage
    localStorage.setItem(SESSION_KEY, JSON.stringify({ paths, activePath, drafts }));
  }, [tabs, activeId]);

  // ---------- 外部文件变更监听：轮询 mtime/size，磁盘被改时提示/自动重载 ----------
  const tabsRef = useRef<FileTab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const diskStamps = useRef<Map<string, string>>(new Map());
  /** 有未保存修改的标签发现磁盘被改 → 弹窗询问 */
  const [reloadPrompt, setReloadPrompt] = useState<string | null>(null);

  const checkExternalChanges = useCallback(async () => {
    for (const t of tabsRef.current) {
      if (!t.path || t.readOnly || t.large) continue;
      try {
        const info = await fileInfo(t.path);
        const stamp = `${info.size}:${info.mtime}`;
        const prev = diskStamps.current.get(t.path);
        if (prev === undefined) {
          diskStamps.current.set(t.path, stamp);
          continue;
        }
        if (prev === stamp) continue;
        diskStamps.current.set(t.path, stamp);
        if (t.dirty) {
          // 内容相同（如 touch / 同步软件原样重写）不提示，避免误判
          try {
            const res = await readTextFile(t.path);
            if (res.content === t.content) continue;
          } catch {
            /* 读不到按有变化处理 */
          }
          setReloadPrompt(t.id);
        } else {
          // 未编辑：静默重载最新内容
          const res = await readTextFile(t.path);
          updateTab(t.id, {
            content: res.content,
            encoding: res.encoding,
            bom: res.bom,
            eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
            dirty: false,
          });
        }
      } catch {
        // 文件被移动/删除/暂不可读：忽略，不干扰编辑
      }
    }
  }, [updateTab]);

  useEffect(() => {
    const iv = window.setInterval(() => void checkExternalChanges(), 3000);
    const onFocus = () => void checkExternalChanges();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkExternalChanges]);

  /** 保存；forceDialog 用于另存为。返回是否成功保存 */
  const saveTab = useCallback(async (tab: FileTab, forceDialog = false): Promise<boolean> => {
    if (tab.readOnly) {
      alert("大文件模式为只读，不支持保存。可用「另存为」导出已加载的部分。");
      return false;
    }
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
      // 关键：保存成功后刷新该文件的磁盘基线，
      // 否则下一次监听节拍会把「自己的保存」误判为外部修改，
      // 弹出「重新加载」导致继续编辑的内容被回退（数据丢失 bug）
      try {
        const info = await fileInfo(path);
        diskStamps.current.set(path, `${info.size}:${info.mtime}`);
      } catch {
        diskStamps.current.delete(path);
      }
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
      // 保存到文件夹树目录内 → 刷新树（保留展开状态）
      if (folderRoot && isUnderFolderRoot(path, folderRoot)) setFolderReloadKey((k) => k + 1);
      // 自动备份（GitHub Gist，15 分钟节流；未启用则跳过）
      maybeAutoBackup();
      return true;
    } catch (e) {
      alert(`保存失败：${e}`);
      return false;
    }
  }, [folderRoot, isUnderFolderRoot]);

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

  /** 删除文件/文件夹（打开中的标签一并关闭） */
  const deleteTreePath = useCallback(async (p: string) => {
    if (!window.confirm(`确认删除「${p.split(/[\\/]/).pop()}」？此操作不可恢复。`)) return;
    try {
      await deletePath(p);
      setFolderReloadKey((k) => k + 1);
      tabs
        .filter((t) => t.path && (t.path === p || t.path.startsWith(`${p}/`) || t.path.startsWith(`${p}\\`)))
        .forEach((t) => closeTab(t.id));
    } catch (e) {
      alert(`删除失败：${e}`);
    }
  }, [tabs, closeTab]);

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

  const playItems = useCallback((items: MacroItem[]) => {
    if (recording || !items.length) return;
    actionCount.current += 1;
    setActionSignal({ type: "macro-replay", n: actionCount.current, items: [...items] });
  }, [recording]);

  const replayMacro = useCallback(() => {
    playItems(macroRef.current);
  }, [playItems]);

  // ---------- 命名宏：保存 / 回放 / 管理 / 导入导出 ----------
  const handleSaveMacro = useCallback((name: string, items: MacroItem[]) => {
    setSavedMacros(addMacro(name, items));
  }, []);
  const handleDeleteMacro = useCallback((id: string) => setSavedMacros(deleteMacro(id)), []);
  const handleRenameMacro = useCallback((id: string, name: string) => setSavedMacros(renameMacro(id, name)), []);
  const handleImportMacros = useCallback((json: string) => setSavedMacros(importMacros(json)), []);
  const handleExportMacros = useCallback(() => {
    const blob = new Blob([exportMacros()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-macros.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);
  const handleMacroTemplate = useCallback(() => {
    const sample = {
      format: "notepp-macros", version: 1,
      macros: [
        { name: "示例：输入问候", items: [{ type: "text", text: "Hello, NotePP!" }] },
        { name: "示例：空两行", items: [{ type: "cmd", cmd: "Enter" }, { type: "cmd", cmd: "Enter" }] },
      ],
    };
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-macros-example.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  // ---------- 快捷键绑定（内置 / 宏 / 片段） ----------
  const handleBindingsChange = useCallback((b: Bindings) => { saveBindings(b); setBindings(b); }, []);
  const handleBindMacro = useCallback((id: string, key: string) => {
    setBindings((prev) => { const next = { ...prev, [`macro:${id}`]: key }; saveBindings(next); return next; });
  }, []);
  const handleBindSnippet = useCallback((id: string, key: string) => {
    setSnippetBindings((prev) => { const next = { ...prev, [`snippet:${id}`]: key }; saveSnippetBindings(next); return next; });
  }, []);
  const shortcutOf = useCallback((id: string) => {
    const b = id.startsWith("snippet:") ? snippetBindings : bindings;
    return b[id] || "";
  }, [bindings, snippetBindings]);
  const openKeymapFor = useCallback((cmd?: string) => { setKeymapFocus(cmd ?? null); setKeymapDialogOpen(true); }, []);

  // ---------- 片段管理 ----------
  const handleAddSnippet = useCallback((abbr: string, body: string, name: string) => setSnippets(addSnippet(abbr, body, name)), []);
  const handleUpdateSnippet = useCallback((id: string, patch: Partial<Pick<Snippet, "abbr" | "body" | "name">>) => setSnippets(updateSnippet(id, patch)), []);
  const handleDeleteSnippet = useCallback((id: string) => setSnippets(deleteSnippet(id)), []);
  const handleImportSnippets = useCallback((json: string) => setSnippets(importSnippets(json)), []);
  const handleExportSnippets = useCallback(() => {
    const blob = new Blob([exportSnippets()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-snippets.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);
  const handleSnippetTemplate = useCallback(() => {
    const blob = new Blob([JSON.stringify({
      format: "notepp-snippets", version: 1,
      snippets: [
        { abbr: "sig", name: "签名", body: "\n—— NotePP\n" },
        { abbr: "now", name: "当前时间", body: "${NOW}" },
      ],
    }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-snippets-example.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

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

  // ---------- 命令执行器（快捷键 / 菜单共用） ----------
  const executeCommand = useCallback((id: string) => {
    // 动态命令：宏
    if (id.startsWith("macro:")) {
      const m = savedMacros.find((x) => x.id === id.slice(6));
      if (m) playItems(m.items);
      return;
    }
    // 动态命令：片段
    if (id.startsWith("snippet:")) {
      const s = snippets.find((x) => x.id === id.slice(8));
      if (s) insertText(expandSnippet(s.body));
      return;
    }
    // 内置命令
    switch (id) {
      case "insert-datetime": insertDateTime("datetime"); break;
      case "insert-date": insertDateTime("date"); break;
      case "insert-time": insertDateTime("time"); break;
      case "insert-comment": insertComment(false); break;
      case "insert-block-comment": insertComment(true); break;
      case "insert-table": setTableOpen(true); break;
      case "insert-divider": insertText("\n---\n"); break;
      case "find": openFind(); break;
      case "find-next": stepFind(1); break;
      case "toggle-sidebar": setLayout((l) => ({ ...l, sidebarOpen: !l.sidebarOpen })); break;
      case "toggle-filelist": setLayout((l) => ({ ...l, filelistOpen: !l.filelistOpen })); break;
      case "toggle-split": toggleSplit(); break;
      case "toggle-preview": setPreviewOpen(true); break;
      case "print": doPrint(); break;
      case "save": if (activeTab) saveTab(activeTab); break;
      case "newtab": newTab(); break;
      case "record-macro": toggleRecord(); break;
      case "replay-macro": replayMacro(); break;
      case "transform-upper": runTransform("upper"); break;
      case "transform-lower": runTransform("lower"); break;
      case "transform-title": runTransform("title"); break;
      case "transform-sort": runTransform("sort"); break;
      case "transform-sort-desc": runTransform("sort-desc"); break;
      case "transform-dedupe": runTransform("dedupe"); break;
      case "transform-trim": runTransform("trim"); break;
      case "transform-remove-blank": runTransform("remove-blank"); break;
      case "transform-add-blank": runTransform("add-blank"); break;
      default: break;
    }
  }, [
    savedMacros, playItems, snippets, insertText, insertDateTime, insertComment,
    openFind, stepFind, toggleSplit, doPrint, activeTab, saveTab, newTab, toggleRecord, replayMacro,
    runTransform,
  ]);

  // ---------- 快捷键（自定义绑定优先 + 内置兜底） ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 快捷键设置弹窗录制时，由弹窗在捕获阶段处理，这里不会收到事件
      const typingInField = !!(e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
      // Esc 关闭查找浮窗（焦点不在浮窗内时也要生效）
      if (e.key === "Escape" && findOpen) { setFindOpen(false); return; }

      const norm = normalizeEvent(e);
      // 1) 完整映射：内置默认 + 用户覆盖 + 动态（宏/片段）
      const map = new Map<string, string>();
      for (const c of BUILTIN_COMMANDS) {
        const k = effectiveKey(c.id, bindings, c.defaultKey);
        if (k) map.set(k, c.id);
      }
      for (const [id, k] of Object.entries(bindings)) if (k && id.startsWith("macro:")) map.set(k, id);
      for (const [id, k] of Object.entries(snippetBindings)) if (k) map.set(k, id);

      let cmd = map.get(norm);
      // ⌘ 是 Mac 上的 Ctrl 等价物；用户显式绑定的 Meta+xxx 优先，所以这里只做兜底
      if (!cmd && norm.startsWith("Meta+")) cmd = map.get(`Ctrl+${norm.slice(5)}`);
      // Shift+F3 复用「跳到下一处」，执行时按 shiftKey 反向
      if (!cmd && norm === "Shift+F3") cmd = map.get("F3");
      // CodeMirror 的搜索 keymap 可能已处理 F3，避免一次按键跳两次
      if (cmd === "find-next" && e.defaultPrevented) return;
      // 输入框里敲普通字符不能被单键命令抢走；带修饰键或功能键仍允许触发
      const hasMod = e.ctrlKey || e.metaKey || e.altKey;
      const isFunctionKey = /^F\d+$/.test(e.key);
      if (cmd && typingInField && !hasMod && !isFunctionKey) return;

      if (cmd) {
        e.preventDefault();
        if (cmd === "find-next") stepFind(e.shiftKey ? -1 : 1);
        else executeCommand(cmd);
        return;
      }
      // 2) 兜底：未纳入命令表的内置键（打开/关闭/反向查找/复位/另存为/切换标签）
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "o") { e.preventDefault(); openDialog(); }
      else if (key === "w") { e.preventDefault(); if (activeId) closeTab(activeId); }
      else if (key === "h") { e.preventDefault(); openFind(); }
      else if (key === "0") { e.preventDefault(); resetZoom(); }
      else if (key === "s" && e.shiftKey) { e.preventDefault(); if (activeTab) saveTab(activeTab, true); }
      else if (key === "tab") {
        e.preventDefault();
        if (tabs.length > 1 && activeId) {
          const idx = tabs.findIndex((t) => t.id === activeId);
          setActiveId(tabs[(idx + 1) % tabs.length].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    bindings, snippetBindings, executeCommand, findOpen, openDialog, closeTab,
    activeTab, activeId, tabs, openFind, stepFind, resetZoom, saveTab,
  ]);

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
    window.addEventListener("notepp.zoom-reset", resetZoom);
    return () => {
      window.removeEventListener("notepp.cycle-encoding", onCycle);
      window.removeEventListener("notepp.zoom-reset", resetZoom);
    };
  }, [activeId, resetZoom]);

  // ---------- 拖拽打开文件 / 文件夹 ----------
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const { paths } = event.payload;
        void (async () => {
          for (const p of paths) {
            let isDir = false;
            try {
              isDir = (await pathIsDir(p)) === true;
            } catch {
              /* 非桌面环境忽略 */
            }
            if (isDir) {
              setFolderRoot(p);
              continue;
            }
            if (isTextFilePath(p)) openPath(p);
            else void insertMedia(p);
          }
        })();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openPath, insertMedia]);

  // ---------- 移动端：双指捏合调整字号（对应桌面 Ctrl+滚轮） ----------
  const zoomRef = useRef(editorSettings.zoom);
  useEffect(() => {
    zoomRef.current = editorSettings.zoom;
  }, [editorSettings.zoom]);
  useEffect(() => {
    let startDist = 0;
    let startZoom = 100;
    const dist = (e: TouchEvent) =>
      Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e);
        startZoom = zoomRef.current;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist > 0) {
        const z = Math.round((startZoom * dist(e)) / startDist / 5) * 5;
        setEditorSettings((s) => clampSettings({ ...s, zoom: z }));
        e.preventDefault(); // 阻止页面级缩放
      }
    };
    const onEnd = () => {
      startDist = 0;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // ---------- 移动端：软键盘弹出时保证输入位置可见 ----------
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // 标题栏
  useEffect(() => {
    document.title = activeTab
      ? `${activeTab.dirty ? "● " : ""}${activeTab.name} - NotePP`
      : "NotePP";
  }, [activeTab]);

  // 全局点击关闭右键菜单 / 变换下拉
  useEffect(() => {
    const hide = () => {
      const menu = document.getElementById("tab-context-menu");
      if (menu) menu.style.display = "none";
      setTransformOpen(false);
    };
    window.addEventListener("click", hide);
    window.addEventListener("blur", hide);
    // 禁用 WebView 自带右键菜单（其「共享」会指向 tauri.localhost），应用内区域均有自定义菜单
    const noNative = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", noNative);
    return () => {
      window.removeEventListener("click", hide);
      window.removeEventListener("blur", hide);
      document.removeEventListener("contextmenu", noNative);
    };
  }, []);

  const lang = detectLanguage(activeTab?.path ?? null);
  const lines = activeTab ? activeTab.content.split("\n").length : 0;
  const wordCount = useMemo(() => (activeTab ? countWords(activeTab.content) : 0), [activeTab?.id, activeTab?.content]);

  // ---------- v0.22.1 菜单栏：数据驱动（emoji/文字显示模式），两层自适应换行 ----------
  const menubarRef = useRef<HTMLDivElement>(null);

  /** 菜单项渲染：图标 + 文字（顺序可倒），显示模式由 CSS 类控制 */
  const mbContent = (it: { ico?: string; txt?: string; icoAfter?: boolean }): ReactNode => (
    <>
      {it.ico && !it.icoAfter && <span className="m-ico">{it.ico}</span>}
      {it.txt && <span className="m-txt">{it.txt}</span>}
      {it.ico && it.icoAfter && <span className="m-ico">{it.ico}</span>}
    </>
  );

  interface MbItem {
    sep?: true;
    ico?: string;
    txt?: string;
    icoAfter?: boolean;
    title?: string;
    onClick?: () => void;
    disabled?: boolean;
    on?: boolean;
    rec?: boolean;
    cls?: string;
    /** 该项自带下拉（变换菜单） */
    drop?: ReactNode;
  }

  const TRANSFORM_ITEMS = [
    { id: "transform-upper", label: "转为大写" },
    { id: "transform-lower", label: "转为小写" },
    { id: "transform-title", label: "首字母大写" },
    { id: "transform-sort", label: "行排序 A→Z" },
    { id: "transform-sort-desc", label: "行排序 Z→A" },
    { id: "transform-dedupe", label: "去除重复行" },
    { id: "transform-trim", label: "去除行首尾空格" },
    { id: "transform-remove-blank", label: "去除空行" },
    { id: "transform-add-blank", label: "增加空行" },
  ];

  const transformDrop = (
    <div className="context-menu transform-menu" onClick={(e) => e.stopPropagation()}>
      {TRANSFORM_ITEMS.map((it) => (
        <button
          key={it.id}
          onClick={() => {
            setTransformOpen(false);
            executeCommand(it.id);
          }}
          title={BUILTIN_COMMANDS.find((c) => c.id === it.id)?.desc}
        >
          {it.label}
          {shortcutOf(it.id) && <span className="menu-key"> {shortcutOf(it.id)}</span>}
        </button>
      ))}
    </div>
  );

  const menuItems: MbItem[] = [
    { ico: "📄", txt: "新建", title: "新建空白标签 (Ctrl+N)", onClick: newTab },
    { ico: "📂", txt: "打开", title: "打开文件", onClick: openDialog },
    { ico: "💾", txt: "保存", title: "保存 (Ctrl+S)", onClick: () => activeTab && saveTab(activeTab) },
    { ico: "📥", txt: "另存为", title: "另存为 (Ctrl+Shift+S)", onClick: () => activeTab && saveTab(activeTab, true) },
    { ico: "🔀", txt: "对比", title: "两个文件逐行对比", onClick: () => setDiffDialog(true) },
    { ico: "🔍", txt: "查找", title: "查找替换 (Ctrl+F，F3 下一处，Shift+F3 反向)", onClick: openFind },
    { sep: true },
    { ico: "🕐", txt: "时间", title: "插入当前日期时间 (Ctrl+Alt+D)", disabled: !activeTab, onClick: () => insertDateTime("datetime") },
    { ico: "💬", txt: "注释", title: "按当前文件类型插入行注释 (Ctrl+Alt+C)", disabled: !activeTab, onClick: () => insertComment(false) },
    { ico: "🔠", txt: "变换 ▾", title: "文字变换：大小写转换、行排序、去重、去行首尾空格", disabled: !activeTab, on: transformOpen, drop: transformDrop },
    { ico: "✖️", txt: "关闭", title: "关闭当前标签 (Ctrl+W)", onClick: () => activeId && closeTab(activeId) },
    { sep: true },
    { ico: "⏺️", txt: recording ? `停止录制 ●${macroLen}` : "录制宏", title: "录制编辑动作 (Ctrl+Shift+R)", rec: recording, onClick: toggleRecord },
    { ico: "▶️", txt: "回放宏", icoAfter: true, title: `回放宏 (Ctrl+Shift+P)${macroLen ? `，共 ${macroLen} 个动作` : "，尚未录制"}`, disabled: recording || macroLen === 0, onClick: replayMacro },
    { ico: "📜", txt: "宏管理", title: "宏管理：保存当前录制为命名宏、回放/重命名/删除、导入导出 JSON", onClick: () => setMacroDialogOpen(true) },
    { ico: "🧩", txt: "片段", title: "片段/模板管理：输入缩写后按 Tab 展开，支持 ${NOW}/${DATE}/${TIME}", onClick: () => setSnippetDialogOpen(true) },
    { ico: "⌨️", txt: "快捷键", title: "快捷键设置：内置命令、宏、片段均可自定义按键", onClick: () => openKeymapFor() },
    { sep: true },
    { ico: "🗂️", txt: "侧栏", title: "显示/隐藏侧栏 (Ctrl+B)", on: layout.sidebarOpen, onClick: () => patchLayout({ sidebarOpen: !layout.sidebarOpen }) },
    { ico: "📋", txt: "列表", title: "显示/隐藏文件列表 (Ctrl+Shift+B)", on: layout.filelistOpen, onClick: () => patchLayout({ filelistOpen: !layout.filelistOpen }) },
    { ico: "📊", txt: "表格", title: "在光标处插入 Markdown 表格", disabled: !activeTab, onClick: () => setTableOpen(true) },
    { ico: "🖼️", txt: "媒体", title: "插入媒体/附件：选择图片、音频、视频或任意文件，按设置的归档策略插入引用（右键编辑区也可插入）", disabled: !activeTab, onClick: () => void pickAndInsertMedia() },
    { ico: imgGenerating ? "⏳" : "🎨", txt: imgGenerating ? "生图…" : "生图", title: "AI 生图：弹窗输入提示词，生成后插入到光标处（需在 AI 设置中填好生图模型）", disabled: !activeTab || imgGenerating, onClick: () => void handleImageGen() },
    { ico: "👁️", txt: "预览", title: "实时预览：贴边右侧面板，编辑即刷新；含全屏、打印、导出 HTML（v0.28）", disabled: !activeTab, on: previewOpen, onClick: () => setPreviewOpen((v) => !v) },
    { ico: "🖍️", txt: "标注", title: "标注导航：当前文件所有划线/高亮/备注列表，点击跳转", disabled: !activeTab, on: annoOpen, onClick: () => setAnnoOpen((v) => !v) },
    { ico: "📑", txt: "目录", title: "大纲目录：解析当前文件 Markdown 标题（#/##/###，不限扩展名），点击跳转", disabled: !activeTab, on: outlineOpen, onClick: () => setOutlineOpen((v) => !v) },
    { ico: "↔️", txt: "分屏", title: "分屏对照：左右同时查看两个文件（再次点击关闭）", on: !!splitId, onClick: toggleSplit },
    { sep: true },
    { ico: "⚙️", txt: "设置", title: "编辑器样式设置：字号/主题/行高/高亮颜色等", onClick: () => setSettingsOpen(true) },
    { ico: "▦", txt: "列选", title: "列编辑模式：矩形选区 + 十字光标（Alt+拖拽也可多行同时编辑）", on: columnMode, onClick: () => setColumnMode((v) => !v) },
    { ico: "🔄", txt: "更新", title: updateInfo?.newer ? `发现新版本 v${updateInfo.latest}` : "检查更新", on: !!updateInfo?.newer, onClick: () => { setUpdateOpen(true); void doCheckUpdate(); } },
    { ico: "🤖", txt: "AI", title: aiReady ? `AI 已就绪：${resolveConfig(aiConfig).model}` : "配置 AI 服务商与 Key", on: aiReady, onClick: () => setAiSettingsOpen(true) },
    { ico: "🌐", txt: "我的网站", title: "访问官网 notepp.ambook.vip（在系统浏览器中打开）", cls: "menubar-secondary", onClick: () => void openUrl("https://notepp.ambook.vip") },
  ];

  return (
    <div className="app">
      {/* 菜单栏（v0.22.1：数据驱动 + 显示模式，两层自适应换行） */}
      <div
        ref={menubarRef}
        className={`menubar menu-${editorSettings.menuDisplay}`}
      >
        {menuItems.map((it, i) =>
          it.sep ? (
            <span key={`s${i}`} className="menubar-sep" />
          ) : it.drop ? (
            <span key={i} className="menu-drop-wrap">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTransformOpen((v) => !v);
                }}
                disabled={it.disabled}
                className={it.on ? "on" : ""}
                title={it.title}
              >
                {mbContent(it)}
              </button>
              {transformOpen && it.drop}
            </span>
          ) : (
            <button
              key={i}
              onClick={it.onClick}
              disabled={it.disabled}
              className={[it.on ? "on" : "", it.rec ? "rec-active" : "", it.cls ?? ""].filter(Boolean).join(" ") || undefined}
              title={it.title}
            >
              {mbContent(it)}
            </button>
          )
        )}
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
        {/* 窄屏抽屉遮罩：点击关闭侧栏/文件列表 */}
        {(layout.sidebarOpen || layout.filelistOpen) && (
          <div
            className="drawer-mask"
            onClick={() => patchLayout({ sidebarOpen: false, filelistOpen: false })}
          />
        )}
        {layout.sidebarOpen && (
          <Sidebar
            categories={categories}
            files={library}
            activeKey={catKey}
            onSelect={setCatKey}
            onCreate={createCategory}
            onRename={renameCategory}
            onDelete={deleteCategory}
            libH={layout.sidebarLibH}
            onLibResize={(h) => patchLayout({ sidebarLibH: clampSidebarLibH(h) })}
          >
            <FolderTree
              root={folderRoot}
              activePath={activeTab?.path ?? null}
              reloadKey={folderReloadKey}
              onOpenFile={openPath}
              onPickFolder={async () => {
                const dir = await openDirectoryDialog();
                if (dir) setFolderRoot(dir);
              }}
              onClear={() => setFolderRoot(null)}
              onCreateFile={createFileIn}
              onCreateFolder={createFolderIn}
              onRename={renameTreePath}
              onDelete={deleteTreePath}
              onReveal={revealTreePath}
              onOpenAll={openAllInDir}
              onOpenFolderOf={openFolderOf}
              onOpenMedia={(p) => void openPathDefault(p).catch((e) => alert(`打开媒体失败：${e}`))}
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
            onOpen={(p) => {
              void openPath(p);
              // 手机上打开文件后自动收起抽屉，避免遮住编辑区
              if (isNarrow()) patchLayout({ filelistOpen: false, sidebarOpen: false });
            }}
            onToggleFav={toggleFav}
            onAssign={assignCategory}
            onRemove={removeFromLibrary}
            onNewFile={newTab}
            onOpenFolderOf={openFolderOf}
            onReveal={revealTreePath}
            onClose={() => patchLayout({ filelistOpen: false })}
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
            onNewTab={newTab}
          />

        <div className="editor-row">
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
            <>
              {activeTab.large && (
                <div className="large-banner">
                  <span>
                    大文件模式（只读）· 已加载 {fmtMB(activeTab.large.loaded)} / 共{" "}
                    {fmtMB(activeTab.large.total)}
                  </span>
                  {activeTab.large.loaded < activeTab.large.total && (
                    <button onClick={loadMoreChunk}>再加载 1MB</button>
                  )}
                  <span className="hint">分块读取，避免一次性载入占满内存</span>
                </div>
              )}
              <Editor
              key={activeTab.id}
              content={activeTab.content}
              languagePath={activeTab.path}
              onChange={(v) => updateTab(activeTab.id, { content: v, dirty: true })}
              onCursor={(line, col, selected, selText, head) => {
                setCursor({ line, col, selected });
                selectionTextRef.current = selText ?? "";
                cursorHeadRef.current = head ?? cursorHeadRef.current;
                if (activeTab.path) saveCursorPos(activeTab.path, line, col);
                else draftCursorRef.current.set(activeTab.id, { line, col });
              }}
              onSignalDone={() => setActionSignal(null)}
              actionSignal={actionSignal}
              settings={editorSettings}
              onZoom={zoomEditor}
              onAiAction={handleAiAction}
              aiReady={aiReady}
              onOpenAiSettings={() => setAiSettingsOpen(true)}
              readOnly={activeTab.readOnly}
              columnMode={columnMode}
              annotations={annotations}
              onAnnotate={handleAnnotate}
              onAnnotationsReplace={persistAnnotations}
              onDeleteAnnotation={handleDeleteAnnotation}
              searchMarks={searchMarks}
              gotoRequest={gotoRequest}
              snippets={snippets}
              mediaDir={activeTab.path ? dirName(activeTab.path) : null}
              renderMedia={editorSettings.renderMedia}
              onInsertMedia={() => void pickAndInsertMedia()}
              onWebSearch={handleWebSearch}
              onFindInNote={openFindWith}
            />
            </>
          )
        )}
      </div>

      {splitTab && (
        <div className="editor-area editor-split">
          <div className="editor-split-head">
            <select
              value={splitTab.id}
              onChange={(e) => setSplitId(e.target.value)}
              title="选择右侧分屏显示的文件"
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button onClick={() => setSplitId(null)} title="关闭分屏">×</button>
          </div>
          <Editor
            key={`split-${splitTab.id}`}
            content={splitTab.content}
            languagePath={splitTab.path}
            onChange={(v) => updateTab(splitTab.id, { content: v, dirty: true })}
            onCursor={() => {}}
            actionSignal={null}
            settings={editorSettings}
            onZoom={zoomEditor}
            readOnly={splitTab.readOnly}
            snippets={snippets}
            mediaDir={splitTab.path ? dirName(splitTab.path) : null}
            renderMedia={editorSettings.renderMedia}
            onWebSearch={handleWebSearch}
            onFindInNote={openFindWith}
          />
        </div>
      )}
      </div>

      {activeTab && (
        <AnnoPanel
          open={annoOpen}
          annotations={annotations}
          onJump={jumpToAnnotation}
          onDelete={handleDeleteAnnotation}
          onClose={() => setAnnoOpen(false)}
          onSpeak={(t) => void handleAnnoSpeak(t)}
          onCopy={(t) => void handleAnnoCopy(t)}
          onPaste={handleAnnoPaste}
        />
      )}

      {activeTab && (
        <OutlinePanel
          open={outlineOpen}
          headings={outline}
          onJump={jumpToOutline}
          onClose={() => setOutlineOpen(false)}
        />
      )}

      {activeTab && (
        <FindBar
          open={findOpen}
          total={findMatches.length}
          current={findMatches.length === 0 ? 0 : findCurrent + 1}
          options={findOptions}
          query={findQuery}
          folderRoot={folderRoot}
          folderHits={folderHits}
          folderLoading={folderLoading}
          folderMessage={folderMessage}
          tabHits={tabHits}
          tabMessage={tabMessage}
          onQuery={setFindQuery}
          onOptions={setFindOptions}
          onStep={stepFind}
          onReplace={doReplace}
          onReplaceAll={doReplaceAll}
          onFolderSearch={(q, o) => void doFolderSearch(q, o)}
          onTabsSearch={(q, o) => doTabsSearch(q, o)}
          onOpenHit={(p, l) => void openFolderHit(p, l)}
          onClose={() => setFindOpen(false)}
          seed={findSeed}
          replaceMessage={replaceMsg}
          resultsOpen={resultsOpen && findOpen}
          onToggleResults={() => setResultsOpen((v) => !v)}
          findScale={editorSettings.findScale}
          onFindScale={(next) => setEditorSettings((s) => clampSettings({ ...s, findScale: next }))}
        />
      )}

      {activeTab && (
        <SearchResults
          open={resultsOpen && findOpen}
          title={`查找「${findQuery}」`}
          hits={searchLineHits}
          activeLine={currentMatchLine}
          onJump={jumpToResultLine}
          onClose={() => setResultsOpen(false)}
        />
      )}

      {activeTab && (
        <StatusBar
          line={cursor.line}
          col={cursor.col}
          selected={cursor.selected}
          lines={lines}
          chars={activeTab.content.length}
          words={wordCount}
          encoding={activeTab.encoding}
          bom={activeTab.bom}
          eol={activeTab.eol}
          language={lang.name}
          path={activeTab.path}
          zoom={editorSettings.zoom}
          aiStatus={aiStatusPill}
          onAiStatusClick={onAiStatusClick}
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
          onOpenKeymap={() => { setSettingsOpen(false); openKeymapFor(); }}
        />
      )}

      {/* 宏管理弹窗 */}
      <MacroDialog
        open={macroDialogOpen}
        macros={savedMacros}
        liveItems={macroRef.current}
        onClose={() => setMacroDialogOpen(false)}
        onSave={handleSaveMacro}
        onReplay={playItems}
        onDelete={handleDeleteMacro}
        onRename={handleRenameMacro}
        onImport={handleImportMacros}
        onExport={handleExportMacros}
        onImportTemplate={handleMacroTemplate}
        shortcutOf={shortcutOf}
        onBindKey={(id) => openKeymapFor(`macro:${id}`)}
      />

      {/* 片段 / 模板管理弹窗 */}
      <SnippetDialog
        open={snippetDialogOpen}
        snippets={snippets}
        shortcutOf={shortcutOf}
        onClose={() => setSnippetDialogOpen(false)}
        onAdd={handleAddSnippet}
        onUpdate={handleUpdateSnippet}
        onDelete={handleDeleteSnippet}
        onImport={handleImportSnippets}
        onExport={handleExportSnippets}
        onTemplate={handleSnippetTemplate}
        onBindKey={(id) => openKeymapFor(`snippet:${id}`)}
      />

      {/* 快捷键设置弹窗 */}
      <KeymapDialog
        open={keymapDialogOpen}
        bindings={bindings}
        snippetBindings={snippetBindings}
        macros={savedMacros}
        snippets={snippets}
        focusCommand={keymapFocus}
        onClose={() => { setKeymapDialogOpen(false); setKeymapFocus(null); }}
        onChange={handleBindingsChange}
        onBindMacro={handleBindMacro}
        onBindSnippet={handleBindSnippet}
      />

      {/* 替换预览弹窗 */}
      <ReplacePreviewDialog
        open={replacePreviewOpen}
        query={findQuery}
        replacement={pendingReplacement}
        previews={replacePreviewItems}
        onClose={() => setReplacePreviewOpen(false)}
        onConfirm={confirmReplace}
      />

      {/* 插入表格 */}
      {tableOpen && (
        <InsertTableDialog onInsert={insertText} onClose={() => setTableOpen(false)} />
      )}

      {/* Markdown 预览 */}
      {previewOpen && activeTab && (
        <PreviewDialog
          title={activeTab.name}
          source={activeTab.content}
          fontSize={effectiveFontSize(editorSettings)}
          mediaDir={activeTab.path ? dirName(activeTab.path) : null}
          onExportHtml={exportPreviewHtml}
          onPrint={doPrint}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* AI 生图对话框（v0.27：生成在后台运行，可随时关闭继续编辑，状态栏显示进度） */}
      {imgPromptOpen && (
        <div className="modal-mask" onClick={() => setImgPromptOpen(false)}>
          <div className="modal img-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>🎨 AI 生图</h2>
              <button className="icon-btn" onClick={() => setImgPromptOpen(false)} title="关闭">
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>图片描述（提示词）</span>
                <textarea
                  rows={4}
                  autoFocus
                  value={imgPromptText}
                  placeholder="例如：赛博朋克风格的城市夜景，霓虹灯，雨夜，电影感构图"
                  onChange={(e) => setImgPromptText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void doImageGen();
                    }
                  }}
                />
              </label>
              <p className="hint">
                生图模型：<b>{resolveConfig(aiConfig).imgModel || "未配置"}</b>（在「AI 设置」中修改）；Ctrl+Enter 直接生成。
                <br />
                生成在<b>后台</b>进行：可先关闭本窗口继续编辑/浏览，完成后自动插入光标处，状态栏会显示进度。
              </p>
              <div className="img-prefs">
                <span className="img-prefs-label">生图偏好（点击追加到提示词）：</span>
                {[
                  ["纯物品，透明背景，无环境", "🧊 透明物品"],
                  ["纯物品，白底产品图，无阴影", "🧻 白底产品"],
                  ["极简风格，居中构图", "🎯 极简居中"],
                  ["高清细节，4k", "🔍 高清细节"],
                ].map(([add, label]) => (
                  <button
                    key={label}
                    type="button"
                    className="img-pref-chip"
                    title={`追加「${add}」`}
                    onClick={() => setImgPromptText((t) => (t ? `${t.replace(/[，,]\s*$/, "")}，${add}` : add))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {imgErr && <p className="msg err" style={{ whiteSpace: "pre-wrap" }}>{imgErr}</p>}
            </div>
            <div className="modal-foot">
              <div className="grow" />
              <button onClick={() => setImgPromptOpen(false)}>
                取消
              </button>
              <button className="primary" onClick={() => void doImageGen()} disabled={!imgPromptText.trim()} title="立即关窗后台生成，完成后自动插入到光标处">
                🎨 生成（后台运行）
              </button>
            </div>
          </div>
        </div>
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
            const pos = aiCustom.pos;
            const tabId = activeId;
            setAiCustom(null);
            void runAi("custom", src, instruction, { tabId, pos });
          }}
        />
      )}

      {/* 检查更新 */}
      {updateOpen && (
        <UpdateDialog
          checking={updateChecking}
          error={updateError}
          info={updateInfo}
          onCheck={() => void doCheckUpdate()}
          onClose={() => setUpdateOpen(false)}
        />
      )}

      {/* AI 结果（v0.27：非阻塞浮窗——点 ▼ 收起到后台继续编辑，状态栏点击恢复） */}
      {aiJob && !aiMin && (
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
          onClose={() => { setAiJob(null); setAiMin(false); }}
          onRetry={() => void runAi(aiJob.action, aiJob.source, aiJob.custom)}
          onMinimize={() => setAiMin(true)}
        />
      )}

      {/* 外部修改提示 */}
      {reloadPrompt && (
        <div className="modal-mask">
          <div className="modal">
            <p>
              「{tabs.find((t) => t.id === reloadPrompt)?.name}」已在磁盘上被其他程序修改，
              你还有未保存的编辑。
            </p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setReloadPrompt(null)}>
                保留我的版本
              </button>
              <button
                onClick={async () => {
                  const id = reloadPrompt;
                  setReloadPrompt(null);
                  const t = tabsRef.current.find((x) => x.id === id);
                  if (!t?.path) return;
                  try {
                    const res = await readTextFile(t.path);
                    updateTab(id, {
                      content: res.content,
                      encoding: res.encoding,
                      bom: res.bom,
                      eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
                      dirty: false,
                    });
                    // 重载后同步磁盘基线，避免后续节拍再次误判
                    const info = await fileInfo(t.path);
                    diskStamps.current.set(t.path, `${info.size}:${info.mtime}`);
                  } catch (e) {
                    alert(`重新加载失败：${e}`);
                  }
                }}
              >
                重新加载（放弃我的修改）
              </button>
            </div>
          </div>
        </div>
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
        <button
          onClick={() => {
            const menu = document.getElementById("tab-context-menu");
            const t = tabs.find((x) => x.id === menu?.dataset.tabId);
            if (t?.path) openFolderOf(t.path);
            menu!.style.display = "none";
          }}
        >
          📂 打开所在文件夹
        </button>
        <button
          onClick={() => {
            const menu = document.getElementById("tab-context-menu");
            const t = tabs.find((x) => x.id === menu?.dataset.tabId);
            if (t?.path) void revealTreePath(t.path);
            menu!.style.display = "none";
          }}
        >
          🖥️ 在系统中显示
        </button>
      </div>
    </div>
  );
}
