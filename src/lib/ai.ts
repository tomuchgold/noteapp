/** AI 能力：多厂商配置（OpenAI 兼容协议）+ 选中文本动作 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ProviderId =
  | "deepseek"
  | "agnes"
  | "sensenova"
  | "zhipu"
  | "moonshot"
  | "qwen"
  | "openai"
  | "openrouter"
  | "ollama"
  | "custom";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseUrl: string;
  /** 预设模型（第一个为默认） */
  models: string[];
  /** 是否需要 API Key（本地 Ollama 不需要） */
  needKey: boolean;
  note?: string;
  /** 预设生图模型（可选，v0.19 起用于 AI 生图） */
  imgModels?: string[];
}

/** 预设厂商：全部走 OpenAI 兼容的 /chat/completions */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek 深度求索",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needKey: true,
    note: "性价比高，中文表现好",
  },
  {
    id: "agnes",
    name: "Agnes AI",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    models: ["agnes-2.5-flash", "agnes-2.5-pro", "agnes-2.5-pro-beta"],
    needKey: true,
    note: "OpenAI 兼容网关，flash 便宜、pro 推理强",
    imgModels: ["agnes-image-2.5-flash"],
  },
  {
    id: "sensenova",
    name: "商汤日日新 SenseNova",
    baseUrl: "https://api.sensenova.cn/compatible-mode/v1",
    models: ["SenseChat-5", "SenseChat-5-1202", "SenseChat-Turbo"],
    needKey: true,
    note: "兼容模式端点；若用新版控制台可改为 https://token.sensenova.cn/v1",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-flash", "glm-4-air"],
    needKey: true,
  },
  {
    id: "moonshot",
    name: "月之暗面 Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    needKey: true,
  },
  {
    id: "qwen",
    name: "阿里通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    needKey: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    needKey: true,
    note: "国内网络通常需要代理",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat"],
    needKey: true,
  },
  {
    id: "ollama",
    name: "Ollama 本地",
    baseUrl: "http://localhost:11434/v1",
    models: ["qwen2.5:7b", "llama3.2", "deepseek-r1:7b"],
    needKey: false,
    note: "本地跑模型，无需 Key，需先启动 Ollama",
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    baseUrl: "",
    models: [],
    needKey: true,
    note: "填写任意 OpenAI 兼容网关，如 one-api / new-api 自建中转",
  },
];

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 生图模型（AI 生图用，可留空表示不支持） */
  imgModel?: string;
  /** 从服务商拉取到的模型列表（v0.24 持久化，界面可视化选择） */
  fetchedModels?: string[];
  /** 手动添加的自定义模型（与拉取列表合并展示） */
  extraModels?: string[];
}

export interface AiConfig {
  /** 当前使用的厂商 */
  active: ProviderId;
  /** 各厂商独立保存的配置，切换不丢 */
  providers: Partial<Record<ProviderId, ProviderConfig>>;
}

export const AI_CONFIG_KEY = "notepp.ai";

export function defaultProviderConfig(p: ProviderPreset): ProviderConfig {
  return { apiKey: "", baseUrl: p.baseUrl, model: p.models[0] ?? "", imgModel: p.imgModels?.[0] ?? "" };
}

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (!raw) return { active: "deepseek", providers: {} };
    const parsed = JSON.parse(raw) as AiConfig;
    return {
      active: parsed.active ?? "deepseek",
      providers: parsed.providers ?? {},
    };
  } catch {
    return { active: "deepseek", providers: {} };
  }
}

export function saveAiConfig(c: AiConfig) {
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* 忽略 */
  }
}

export function providerPreset(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

export function resolveConfig(c: AiConfig, id: ProviderId = c.active): ProviderConfig {
  const preset = providerPreset(id);
  return { ...defaultProviderConfig(preset), ...(c.providers[id] ?? {}) };
}

/** 是否已可调用（Key 或本地地址齐备） */
export function isConfigured(c: AiConfig, id: ProviderId = c.active): boolean {
  const preset = providerPreset(id);
  const cfg = resolveConfig(c, id);
  const keyOk = !preset.needKey || cfg.apiKey.trim().length > 0;
  return keyOk && cfg.baseUrl.trim().length > 0 && cfg.model.trim().length > 0;
}

/** 生图是否可用（地址 + Key + 生图模型齐备） */
export function isImageReady(c: AiConfig, id: ProviderId = c.active): boolean {
  const preset = providerPreset(id);
  const cfg = resolveConfig(c, id);
  const keyOk = !preset.needKey || cfg.apiKey.trim().length > 0;
  return keyOk && cfg.baseUrl.trim().length > 0 && (cfg.imgModel ?? "").trim().length > 0;
}

// ---------- 动作 ----------

export type AiAction =
  | "explain"
  | "polish"
  | "summarize"
  | "to-zh"
  | "to-en"
  | "code-comment"
  | "custom";

export const AI_ACTIONS: { id: AiAction; label: string; hint: string }[] = [
  { id: "explain", label: "解释这段内容", hint: "讲清含义与上下文" },
  { id: "polish", label: "润色改写", hint: "保持原意，改得更通顺" },
  { id: "summarize", label: "提炼要点", hint: "压缩成要点列表" },
  { id: "to-zh", label: "翻译成中文", hint: "保留专有名词" },
  { id: "to-en", label: "翻译成英文", hint: "自然地道" },
  { id: "code-comment", label: "生成代码注释", hint: "按原文语言加注释" },
  { id: "custom", label: "自定义指令…", hint: "自己描述要做什么" },
];

function buildMessages(action: AiAction, text: string, custom?: string) {
  const system =
    "你是 NotePP 编辑器内置的写作与代码助手。只输出处理结果本身，不要寒暄、不要复述指令、不要用 Markdown 代码块包裹整体输出。";
  let user = "";
  switch (action) {
    case "explain":
      user = `请解释下面这段内容（它的含义、作用或潜在问题），简洁分点：\n\n${text}`;
      break;
    case "polish":
      user = `请润色下面这段文字，保持原意与语言不变，只输出润色后的文本：\n\n${text}`;
      break;
    case "summarize":
      user = `请把下面内容提炼为要点（每条一行，以 - 开头），不要添加原文没有的信息：\n\n${text}`;
      break;
    case "to-zh":
      user = `请把下面内容翻译成中文，保留专有名词与代码标识符：\n\n${text}`;
      break;
    case "to-en":
      user = `请把下面内容翻译成英文，表达自然：\n\n${text}`;
      break;
    case "code-comment":
      user = `请为下面这段代码补充注释（就地插入注释，保持原有代码不变，按原语言的注释语法）：\n\n${text}`;
      break;
    case "custom":
      user = `${custom ?? "请处理下面的内容"}：\n\n${text}`;
      break;
  }
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export interface AiCallResult {
  content: string;
  model: string;
  tokens?: number;
}

export async function runAiAction(
  config: AiConfig,
  action: AiAction,
  text: string,
  custom?: string
): Promise<AiCallResult> {
  const cfg = resolveConfig(config);
  if (!cfg.baseUrl.trim()) throw new Error("未配置 API 地址，请打开「AI 设置」");
  if (providerPreset(config.active).needKey && !cfg.apiKey.trim())
    throw new Error("未配置 API Key，请打开「AI 设置」");
  if (!cfg.model.trim()) throw new Error("未配置模型名称，请打开「AI 设置」");

  return invoke<AiCallResult>("ai_chat", {
    req: {
      base_url: cfg.baseUrl,
      api_key: cfg.apiKey,
      model: cfg.model,
      messages: buildMessages(action, text, custom),
      temperature: 0.3,
    },
  });
}

/** 流式版本：边收边回调，返回完整文本（失败抛错） */
export async function runAiActionStream(
  config: AiConfig,
  action: AiAction,
  text: string,
  custom: string | undefined,
  onDelta: (delta: string) => void
): Promise<AiCallResult> {
  const cfg = resolveConfig(config);
  if (!cfg.baseUrl.trim()) throw new Error("未配置 API 地址，请打开「AI 设置」");
  if (providerPreset(config.active).needKey && !cfg.apiKey.trim())
    throw new Error("未配置 API Key，请打开「AI 设置」");
  if (!cfg.model.trim()) throw new Error("未配置模型名称，请打开「AI 设置」");

  const id = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let acc = "";
  let tokens: number | undefined;

  const unChunk = await listen<{ id: string; delta: string }>("ai://chunk", (e) => {
    if (e.payload.id !== id) return;
    acc += e.payload.delta;
    onDelta(e.payload.delta);
  });
  const unDone = await listen<{ id: string; model: string; tokens?: number }>("ai://done", (e) => {
    if (e.payload.id !== id) return;
    if (e.payload.tokens) tokens = e.payload.tokens;
  });

  try {
    await invoke("ai_chat_stream", {
      id,
      req: {
        base_url: cfg.baseUrl,
        api_key: cfg.apiKey,
        model: cfg.model,
        messages: buildMessages(action, text, custom),
        temperature: 0.3,
      },
    });
    return { content: acc, model: cfg.model, tokens };
  } finally {
    unChunk();
    unDone();
  }
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  return invoke<string[]>("ai_models", { baseUrl, apiKey });
}

/** AI 生图：调 OpenAI 兼容 /images/generations，返回图片 URL（b64 已转 data URL） */
export async function runImageGen(config: AiConfig, prompt: string, n = 1, size?: string): Promise<string[]> {
  const cfg = resolveConfig(config);
  if (!cfg.baseUrl.trim()) throw new Error("未配置 API 地址，请打开「AI 设置」");
  if (providerPreset(config.active).needKey && !cfg.apiKey.trim())
    throw new Error("未配置 API Key，请打开「AI 设置」");
  if (!(cfg.imgModel ?? "").trim()) throw new Error("未配置生图模型，请打开「AI 设置」");
  const res = await invoke<{ urls: string[]; model: string }>("ai_image", {
    req: {
      base_url: cfg.baseUrl,
      api_key: cfg.apiKey,
      model: cfg.imgModel,
      prompt,
      n,
      size: size ?? null,
    },
  });
  return res.urls;
}

/** 把底层报错翻译成人话（v0.24：常见错误给出可操作建议） */
export function friendlyAiError(e: unknown, model?: string): string {
  const raw = String(e instanceof Error ? e.message : e);
  const m = model ?? "";
  if (/model is not found|model_not_found/i.test(raw) || (/404/.test(raw) && /model/i.test(raw)))
    return `模型「${m || "当前模型"}」在该服务商不存在（404）。\n常见原因：切换服务商后模型名没跟着换、模型名拼写不对、该模型未在服务商控制台开通。\n解决办法：打开「AI 设置」→ 点「拉取模型列表」→ 从列表里点选一个模型，保存后重试。`;
  if (/401|invalid.*key|unauthorized/i.test(raw))
    return "API Key 无效或未授权（401）：请检查 Key 是否复制完整、是否属于当前服务商。";
  if (/429|rate.?limit/i.test(raw)) return "请求过于频繁或额度用尽（429）：稍后重试，或到服务商后台检查余额/限额。";
  if (/timeout|timed out/i.test(raw)) return "请求超时：网络不通或代理未开启，请检查网络/代理后重试。";
  if (/failed to fetch|connection|ECONNREFUSED|dns/i.test(raw))
    return "无法连接到服务商：检查 API 地址是否正确、网络/代理是否可用（OpenAI 等国内需代理）。";
  return raw;
}

/** 导出配置（含 Key，明文，导入前请确认接收方可信） */
export function exportAiConfig(c: AiConfig): string {
  return JSON.stringify(
    {
      app: "NotePP",
      kind: "ai-config",
      version: 1,
      exportedAt: new Date().toISOString(),
      active: c.active,
      providers: c.providers,
    },
    null,
    2
  );
}

/** 导入配置：只接受本应用导出的结构，容错合并 */
export function importAiConfig(json: string): AiConfig {
  const data = JSON.parse(json) as Partial<AiConfig> & { kind?: string };
  if (!data || typeof data !== "object" || !data.providers)
    throw new Error("配置文件格式不正确：缺少 providers 字段");
  const cleaned: AiConfig["providers"] = {};
  for (const [k, v] of Object.entries(data.providers)) {
    if (!PROVIDERS.some((p) => p.id === k)) continue;
    const cfg = v as ProviderConfig;
    cleaned[k as ProviderId] = {
      apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
      baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : "",
      model: typeof cfg.model === "string" ? cfg.model : "",
      imgModel: typeof cfg.imgModel === "string" ? cfg.imgModel : undefined,
      fetchedModels: Array.isArray(cfg.fetchedModels) ? cfg.fetchedModels.filter((m) => typeof m === "string") : undefined,
      extraModels: Array.isArray(cfg.extraModels) ? cfg.extraModels.filter((m) => typeof m === "string") : undefined,
    };
  }
  const active = PROVIDERS.some((p) => p.id === data.active) ? (data.active as ProviderId) : "deepseek";
  return { active, providers: cleaned };
}
