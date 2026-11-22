import { useState } from "react";
import { DEFAULT_SETTINGS, UI_SCALE_MAX, UI_SCALE_MIN, ZOOM_MAX, ZOOM_MIN, type EditorSettings } from "../lib/settings";
import {
  backupConfigured,
  doBackup,
  doRestore,
  loadBackupConfig,
  saveBackupConfig,
  type BackupConfig,
} from "../lib/backup";
import {
  loadTtsConfig,
  saveTtsConfig,
  speak,
  stopSpeaking,
  type TtsConfig,
} from "../lib/tts";
import {
  allThemes,
  isValidTheme,
  loadCustomThemes,
  saveCustomThemes,
  themeTemplate,
  type ThemeDef,
} from "../lib/themes";

interface Props {
  value: EditorSettings;
  onChange: (s: EditorSettings) => void;
  onClose: () => void;
  onOpenKeymap: () => void;
}

export default function SettingsDialog({ value, onChange, onClose, onOpenKeymap }: Props) {
  const set = (patch: Partial<EditorSettings>) => onChange({ ...value, ...patch });
  const [themes, setThemes] = useState<ThemeDef[]>(() => allThemes());
  const [customMsg, setCustomMsg] = useState<string | null>(null);
  const [tts, setTts] = useState<TtsConfig>(() => loadTtsConfig());
  const [ttsMsg, setTtsMsg] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupConfig>(() => loadBackupConfig());
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const setBk = (patch: Partial<BackupConfig>) => {
    const next = { ...backup, ...patch };
    setBackup(next);
    saveBackupConfig(next);
  };
  const runBackup = async () => {
    setBackupMsg(null);
    setBackupBusy(true);
    try {
      const id = await doBackup(backup);
      setBackup(id ? { ...backup, gistId: id } : backup);
      saveBackupConfig({ ...backup, gistId: id });
      setBackupMsg(`✅ 备份成功（Gist ${id.slice(0, 8)}…）`);
    } catch (e) {
      setBackupMsg(`❌ 备份失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setBackupBusy(false);
    }
  };
  const runRestore = async () => {
    setBackupMsg(null);
    setBackupBusy(true);
    try {
      const msg = await doRestore(backup);
      setBackupMsg(msg.includes("已恢复") ? `✅ ${msg}` : msg);
    } catch (e) {
      setBackupMsg(`❌ 恢复失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setBackupBusy(false);
    }
  };
  const setTtsCfg = (patch: Partial<TtsConfig>) => {
    const next = { ...tts, ...patch };
    setTts(next);
    saveTtsConfig(next);
  };
  const trySpeak = () => {
    setTtsMsg(null);
    stopSpeaking();
    speak("你好，这是 NotePP 的朗读试听。Hello from NotePP.", tts)
      .then(() => setTtsMsg("正在朗读…点击「停止」可中断"))
      .catch((e) => setTtsMsg(`朗读失败：${e instanceof Error ? e.message : e}`));
  };

  /** 设置项标签：emoji 图标 + 名称 + 悬停说明（原生 title，桌面与安卓均可用） */
  const Label = ({ icon, name, tip, dim }: { icon: string; name: string; tip: string; dim?: React.ReactNode }) => (
    <label title={tip}>
      <span className="setting-emoji" aria-hidden="true">{icon}</span>
      <span className="setting-name">{name}</span>
      {dim}
    </label>
  );

  const importCustom = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        const valid = list.filter(isValidTheme) as ThemeDef[];
        if (valid.length === 0) {
          setCustomMsg("导入失败：JSON 不是合法的主题格式（可用「导出模板」参考）");
          return;
        }
        const existing = loadCustomThemes().filter(
          (t) => !valid.some((v) => v.id === t.id)
        );
        const merged = [...existing, ...valid];
        saveCustomThemes(merged);
        setThemes(allThemes());
        setCustomMsg(`已导入 ${valid.length} 个主题：${valid.map((t) => t.name).join("、")}`);
      } catch (e) {
        setCustomMsg(`导入失败：${e instanceof Error ? e.message : e}`);
      }
    };
    input.click();
  };

  const exportCustom = () => {
    const custom = loadCustomThemes();
    if (custom.length === 0) {
      setCustomMsg("还没有自定义主题。可先导入 JSON，或用「导出模板」自己改一份。");
      return;
    }
    const blob = new Blob([JSON.stringify(custom, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-themes.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setCustomMsg(`已导出 ${custom.length} 个自定义主题`);
  };

  const exportTemplate = () => {
    const blob = new Blob([themeTemplate()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-theme-template.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setCustomMsg("模板已下载：改好颜色后用「导入主题」加进来");
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h3>编辑器设置 <span style={{opacity:.5,fontSize:12,fontWeight:400}}>v{__APP_VERSION__}</span></h3>

        <div className="setting-row">
          <Label icon="🔤" name="基准字号" tip="编辑区正文的基础字体大小（像素）。所有缩放都以此为起点。" dim={<span className="dim">{value.fontSize}px</span>} />
          <input
            type="range"
            min={11}
            max={24}
            step={1}
            value={value.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🔍" name="正文字号缩放" tip="正文整体缩放比例。在编辑区按住 Ctrl/⌘ 滚动鼠标滚轮可快速调整，最大放大到 900px；Ctrl/⌘+0 复位。" dim={<span className="dim">{value.zoom}%（最大 900px）</span>} />
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={5}
            value={value.zoom}
            onChange={(e) => set({ zoom: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🖥️" name="界面字号" tip="整体界面文字大小：菜单栏、侧栏、文件列表、标签栏、状态栏、各类面板等（不影响编辑区正文）。" dim={<span className="dim">{value.uiScale}% · 菜单/侧栏/面板</span>} />
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={10}
            value={value.uiScale}
            onChange={(e) => set({ uiScale: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🔎" name="查找框字号" tip="查找替换浮窗内的文字大小。也可直接点浮窗标题栏的 A− / A+ 按钮快速调整。" dim={<span className="dim">{value.findScale}%</span>} />
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={10}
            value={value.findScale}
            onChange={(e) => set({ findScale: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <Label icon="📏" name="行高" tip="正文每行之间的间距倍数。稍大的行高阅读更舒适。" dim={<span className="dim">×{value.lineHeight.toFixed(1)}</span>} />
          <input
            type="range"
            min={1.2}
            max={2.4}
            step={0.1}
            value={value.lineHeight}
            onChange={(e) => set({ lineHeight: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <Label icon="➡️" name="Tab 宽度" tip="按一次 Tab 键相当于几个空格的宽度，影响缩进对齐。" />
          <select
            value={value.tabSize}
            onChange={(e) => set({ tabSize: Number(e.target.value) })}
          >
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
            <option value={8}>8 空格</option>
          </select>
        </div>

        <div className="setting-row setting-theme">
          <Label icon="🎨" name="编辑器主题" tip="切换整体界面配色，包含编辑区与菜单/侧栏/状态栏等。可选内置主题，或导入自定义主题 JSON。" />
          <div className="theme-grid">
            {themes.map((t) => (
              <button
                key={t.id}
                className={`theme-swatch ${value.theme === t.id ? "on" : ""}`}
                style={{ background: t.colors.bg, color: t.colors.fg }}
                title={`${t.name}${loadCustomThemes().some((c) => c.id === t.id) ? "（自定义）" : ""}`}
                onClick={() => set({ theme: t.id })}
              >
                <span className="theme-swatch-a" style={{ background: t.colors.accent }} />
                <span className="theme-swatch-p" style={{ background: t.colors.para }} />
                {t.name}
              </button>
            ))}
          </div>
          <div className="theme-ops">
            <button onClick={importCustom}>导入主题</button>
            <button onClick={exportCustom}>导出我的主题</button>
            <button onClick={exportTemplate}>导出模板</button>
          </div>
          {customMsg && <div className="dim theme-msg">{customMsg}</div>}
        </div>

        <div className="setting-row">
          <Label icon="↩️" name="自动换行" tip="行内容超出窗口宽度时自动折行显示，方便阅读长文本。" />
          <input
            type="checkbox"
            checked={value.wrap}
            onChange={(e) => set({ wrap: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🔳" name="显示空白符" tip="用可见符号标出空格与制表符，便于检查缩进和对齐（排版/代码场景很有用）。" />
          <input
            type="checkbox"
            checked={value.showWhitespace}
            onChange={(e) => set({ showWhitespace: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="📍" name="当前行高亮" tip="用强调色淡染 + 行首竖条标出光标所在的整行，与主题背景明显区分。" />
          <input
            type="checkbox"
            checked={value.activeLine}
            onChange={(e) => set({ activeLine: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="📄" name="当前段落高亮" tip="高亮光标所在的整个段落（以空行分隔的一段文字），方便聚焦当前写作段落。" />
          <input
            type="checkbox"
            checked={value.paragraphHighlight}
            onChange={(e) => set({ paragraphHighlight: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🌈" name="高亮颜色" tip="自定义当前行/段落高亮的颜色。留空则跟随当前主题的强调色（淡染背景 + 左侧竖条）。" dim={<span className="dim">{value.paraColor ? "自定义" : "跟随主题（强调色淡染+左竖条）"}</span>} />
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="color"
              value={value.paraColor || "#3a4256"}
              disabled={!value.paragraphHighlight && !value.activeLine}
              onChange={(e) => set({ paraColor: e.target.value })}
              title="光标所在行/段落的高亮背景色"
            />
            {value.paraColor && (
              <button onClick={() => set({ paraColor: "" })} title="恢复为当前主题的配色">
                跟随主题
              </button>
            )}
          </span>
        </div>

        <div className="setting-row">
          <Label icon="⌨️" name="快捷键" tip="自定义内置命令、命名宏、代码片段的快捷键；也支持插入日期时间、注释、表格等快捷命令。" />
          <button onClick={onOpenKeymap}>打开快捷键设置</button>
        </div>

        <div className="setting-row">
          <Label icon="🖼️" name="媒体归档" tip="自动归档：插入的媒体复制到文档同目录 media/ 文件夹（推荐，移动文档不丢素材）；相对引用：不复制文件，直接写相对路径引用原位置。" dim={<span className="dim">{value.mediaMode === "copy" ? "自动复制到 media/" : "相对路径引用"}</span>} />
          <select value={value.mediaMode} onChange={(e) => set({ mediaMode: e.target.value as "copy" | "relative" })}>
            <option value="copy">自动归档到 media/</option>
            <option value="relative">相对路径引用（不复制）</option>
          </select>
        </div>

        <div className="setting-row">
          <Label icon="🎬" name="内嵌媒体渲染" tip="在编辑器里直接显示图片缩略图和音频/视频播放控件；关闭则全部按原文显示。光标所在行始终显示原文，方便编辑引用。" />
          <input
            type="checkbox"
            checked={value.renderMedia}
            onChange={(e) => set({ renderMedia: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🔊" name="朗读引擎" tip="系统内置：无需配置、离线可用（推荐）；OpenAI 兼容接口：填 API 地址与 Key，用云端音色朗读。" dim={<span className="dim">{tts.engine === "system" ? "系统内置（离线）" : "OpenAI 兼容接口"}</span>} />
          <select value={tts.engine} onChange={(e) => setTtsCfg({ engine: e.target.value as TtsConfig["engine"] })}>
            <option value="system">系统内置（免配置）</option>
            <option value="openai">OpenAI 兼容接口</option>
          </select>
        </div>

        {tts.engine === "openai" && (
          <>
            <div className="setting-row">
              <Label icon="🌐" name="TTS 接口地址" tip="OpenAI 兼容 /audio/speech 接口的基础地址，例如 https://api.openai.com/v1。" />
              <input
                type="text"
                value={tts.apiBase}
                placeholder="https://api.openai.com/v1"
                style={{ width: 220 }}
                onChange={(e) => setTtsCfg({ apiBase: e.target.value })}
              />
            </div>
            <div className="setting-row">
              <Label icon="🔑" name="TTS API Key" tip="朗读接口的鉴权 Key，保存在本地，不会上传。" />
              <input
                type="password"
                value={tts.apiKey}
                placeholder="sk-…"
                style={{ width: 220 }}
                onChange={(e) => setTtsCfg({ apiKey: e.target.value })}
              />
            </div>
            <div className="setting-row">
              <Label icon="🧠" name="TTS 模型" tip="例如 tts-1 / tts-1-hd，按服务商支持的填写。" />
              <input type="text" value={tts.model} style={{ width: 120 }} onChange={(e) => setTtsCfg({ model: e.target.value })} />
            </div>
            <div className="setting-row">
              <Label icon="🎙️" name="TTS 音色" tip="例如 alloy / echo / fable / onyx / nova / shimmer。" />
              <input type="text" value={tts.voice} style={{ width: 120 }} onChange={(e) => setTtsCfg({ voice: e.target.value })} />
            </div>
          </>
        )}

        <div className="setting-row">
          <Label icon="▶️" name="试听" tip="用当前朗读引擎播放一句示例，验证配置是否可用。" />
          <span style={{ display: "flex", gap: 6 }}>
            <button onClick={trySpeak}>🔊 试听</button>
            <button onClick={() => { stopSpeaking(); setTtsMsg(null); }}>⏹️ 停止</button>
          </span>
        </div>
        {ttsMsg && <div className="dim theme-msg">{ttsMsg}</div>}

        <div className="setting-row">
          <Label icon="☁️" name="GitHub Token" tip="用于把笔记与设置备份到你的私有 GitHub Gist。需要一个有 gist 权限的 Token（GitHub → Settings → Developer settings → Personal access tokens）。" dim={<span className="dim">{backup.token ? "已配置" : "未配置"}</span>} />
          <input
            type="password"
            value={backup.token}
            placeholder="github_pat_… / ghp_…"
            style={{ width: 220 }}
            onChange={(e) => setBk({ token: e.target.value })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🆔" name="Gist ID" tip="备份存放的 Gist。留空时点「立即备份」会自动创建私有 Gist 并回填；之后每次备份都更新这个 Gist。" dim={<span className="dim">{backupConfigured(backup) ? "就绪" : backup.gistId ? "缺 Token" : "首次备份自动创建"}</span>} />
          <input
            type="text"
            value={backup.gistId}
            placeholder="首次备份自动创建"
            style={{ width: 220 }}
            onChange={(e) => setBk({ gistId: e.target.value })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🔄" name="自动备份" tip="每次保存文件后自动备份到 GitHub（15 分钟节流，避免频繁请求）。" />
          <input
            type="checkbox"
            checked={backup.autoBackup}
            onChange={(e) => setBk({ autoBackup: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="📤" name="立即备份 / 恢复" tip="备份：把文件库中所有文件内容 + 标注 + 全部设置上传到私有 Gist；恢复：从 Gist 下载并覆盖本地（会先确认）。" />
          <span style={{ display: "flex", gap: 6 }}>
            <button disabled={backupBusy || !backup.token.trim()} onClick={() => void runBackup()}>
              {backupBusy ? "处理中…" : "📤 立即备份"}
            </button>
            <button disabled={backupBusy || !backupConfigured(backup)} onClick={() => void runRestore()}>
              ⬇️ 从云端恢复
            </button>
          </span>
        </div>
        {backupMsg && <div className="dim theme-msg">{backupMsg}</div>}

        <div className="modal-actions">
          <button onClick={() => onChange({ ...DEFAULT_SETTINGS })}>恢复默认</button>
          <button className="primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
