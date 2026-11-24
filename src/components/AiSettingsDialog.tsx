import { useState } from "react";
import {
  PROVIDERS,
  defaultProviderConfig,
  exportAiConfig,
  fetchModels,
  importAiConfig,
  isConfigured,
  providerPreset,
  resolveConfig,
  type AiConfig,
  type ProviderConfig,
  type ProviderId,
} from "../lib/ai";
import { openFileDialog, readTextFile, saveFileDialog, writeTextFile } from "../lib/files";

interface Props {
  config: AiConfig;
  onSave: (c: AiConfig) => void;
  onClose: () => void;
}

export default function AiSettingsDialog({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AiConfig>(() => JSON.parse(JSON.stringify(config)) as AiConfig);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [newModel, setNewModel] = useState("");

  const preset = providerPreset(draft.active);
  const cfg: ProviderConfig = { ...defaultProviderConfig(preset), ...(draft.providers[draft.active] ?? {}) };

  // 展示的模型列表：拉取到的（已持久化）→ 预设，另加手动添加的自定义模型
  const modelList = Array.from(new Set([...(cfg.fetchedModels ?? []), ...(cfg.extraModels ?? []), ...preset.models]));
  const currentModel = cfg.model;

  function patchCfg(patch: Partial<ProviderConfig>) {
    setDraft((d) => ({
      ...d,
      providers: { ...d.providers, [d.active]: { ...cfg, ...patch } },
    }));
  }

  function switchProvider(id: ProviderId) {
    setDraft((d) => ({
      ...d,
      active: id,
      // 首次切换时写入预设，避免空表单
      providers: { ...d.providers, [id]: d.providers[id] ?? defaultProviderConfig(providerPreset(id)) },
    }));
  }

  async function pullModels() {
    setBusy(true);
    setMsg(null);
    try {
      const list = await fetchModels(cfg.baseUrl, cfg.apiKey);
      // 持久化拉取结果（保存后仍可见），并自动补进 extraModels 若为空
      patchCfg({ fetchedModels: list });
      setMsg({ type: "ok", text: `拉取到 ${list.length} 个模型，已列入下方模型列表（点选即用）` });
    } catch (e) {
      setMsg({ type: "err", text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  function addCustomModel() {
    const m = newModel.trim();
    if (!m) return;
    if (modelList.includes(m)) {
      patchCfg({ model: m });
      setNewModel("");
      return;
    }
    patchCfg({ extraModels: [...(cfg.extraModels ?? []), m], model: m });
    setNewModel("");
    setMsg({ type: "ok", text: `已添加并选用模型 ${m}` });
  }

  function removeExtraModel(m: string) {
    const next = (cfg.extraModels ?? []).filter((x) => x !== m);
    patchCfg({ extraModels: next, ...(cfg.model === m ? { model: next[0] ?? preset.models[0] ?? "" } : {}) });
  }

  async function doExport() {
    try {
      const path = await saveFileDialog("notepp-ai-config.json");
      if (!path) return;
      await writeTextFile({
        path,
        content: exportAiConfig(draft),
        encoding: "UTF-8",
        bom: false,
        eol: "LF",
      });
      setMsg({ type: "ok", text: `已导出到 ${path}` });
    } catch (e) {
      setMsg({ type: "err", text: `导出失败：${String(e instanceof Error ? e.message : e)}` });
    }
  }

  async function doImport() {
    try {
      const paths = await openFileDialog();
      if (!paths || !paths.length) return;
      const res = await readTextFile(paths[0]);
      const next = importAiConfig(res.content);
      setDraft(next);
      setMsg({ type: "ok", text: "配置已导入，确认后点「保存」生效" });
    } catch (e) {
      setMsg({ type: "err", text: `导入失败：${String(e instanceof Error ? e.message : e)}` });
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal ai-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>AI 设置</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>服务商</span>
            <select value={draft.active} onChange={(e) => switchProvider(e.target.value as ProviderId)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {preset.note && <p className="hint">{preset.note}</p>}

          <label className="field">
            <span>API 地址</span>
            <input
              value={cfg.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => patchCfg({ baseUrl: e.target.value })}
            />
          </label>

          <label className="field">
            <span>API Key{preset.needKey ? "" : "（本地可不填）"}</span>
            <input
              type="password"
              value={cfg.apiKey}
              placeholder={preset.needKey ? "sk-..." : "可选"}
              onChange={(e) => patchCfg({ apiKey: e.target.value })}
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>模型（当前：{currentModel || "未选择"}）</span>
            <input
              value={cfg.model}
              list="ai-model-options"
              placeholder={preset.models[0] ?? "填写模型名称"}
              onChange={(e) => patchCfg({ model: e.target.value })}
            />
            <datalist id="ai-model-options">
              {modelList.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          {/* v0.24：可视化模型列表——点选即用，来源为「拉取 + 预设 + 手动添加」 */}
          <div className="field">
            <span>模型列表（点击选用；{cfg.fetchedModels?.length ? "含拉取结果" : "预设模型，可点下方「拉取模型列表」刷新"}）</span>
            <div className="model-list">
              {modelList.length === 0 && <p className="hint">暂无模型，点「拉取模型列表」或手动添加。</p>}
              {modelList.map((m) => (
                <div key={m} className={`model-chip ${m === currentModel ? "on" : ""}`}>
                  <button type="button" className="model-pick" title={`选用 ${m}`} onClick={() => patchCfg({ model: m })}>
                    {m === currentModel ? "✓ " : ""}
                    {m}
                  </button>
                  {(cfg.extraModels ?? []).includes(m) && (
                    <button type="button" className="model-del" title="移除此自定义模型" onClick={() => removeExtraModel(m)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="model-add">
              <input
                value={newModel}
                placeholder="手动添加其他模型名，如 claude-sonnet-4-5"
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomModel();
                  }
                }}
              />
              <button type="button" onClick={addCustomModel}>
                ＋ 添加并选用
              </button>
            </div>
          </div>

          <label className="field">
            <span>生图模型（可选，AI 生图用）</span>
            <input
              value={cfg.imgModel ?? ""}
              list="ai-img-model-options"
              placeholder={preset.imgModels?.[0] ?? "如 agnes-image-2.5-flash / dall-e-3"}
              onChange={(e) => patchCfg({ imgModel: e.target.value })}
            />
            <datalist id="ai-img-model-options">
              {(preset.imgModels ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          <div className="row-actions">
            <button onClick={pullModels} disabled={busy}>
              {busy ? "拉取中…" : "拉取模型列表"}
            </button>
            <button onClick={doExport} title="导出为 JSON（含 Key，明文）">
              导出配置
            </button>
            <button onClick={doImport} title="从 JSON 导入并覆盖">
              导入配置
            </button>
          </div>

          {msg && <p className={`msg ${msg.type}`}>{msg.text}</p>}

          <p className="hint warn">
            Key 保存在本机 localStorage（明文），导出文件同样明文，请勿分享给他人；建议在服务商后台设置额度上限。
          </p>
        </div>

        <div className="modal-foot">
          <span className={`status-dot ${isConfigured(draft) ? "ok" : ""}`}>
            {isConfigured(draft) ? `当前可用：${resolveConfig(draft).model}` : "尚未配置完成"}
          </span>
          <div className="grow" />
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => onSave(draft)}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
