/**
 * 朗读（TTS）支持（v0.17）
 * - 系统内置引擎：Chromium WebView 的 speechSynthesis，零配置、离线可用
 * - OpenAI 兼容接口：POST {apiBase}/audio/speech，返回音频流直接播放
 * 朗读内容限制 3000 字符以内，避免长文本请求/合成过慢。
 */

export interface TtsConfig {
  /** 引擎：system = 系统内置（Web Speech），openai = OpenAI 兼容接口 */
  engine: "system" | "openai";
  /** 接口基础地址（openai 引擎用） */
  apiBase: string;
  apiKey: string;
  /** 模型名（openai 引擎用） */
  model: string;
  /** 音色（openai 引擎用） */
  voice: string;
}

const KEY = "notepp.tts";

export const DEFAULT_TTS: TtsConfig = {
  engine: "system",
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  model: "tts-1",
  voice: "alloy",
};

export function loadTtsConfig(): TtsConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_TTS };
    const v = JSON.parse(raw) as Partial<TtsConfig>;
    return {
      engine: v.engine === "openai" ? "openai" : "system",
      apiBase: typeof v.apiBase === "string" && v.apiBase ? v.apiBase : DEFAULT_TTS.apiBase,
      apiKey: typeof v.apiKey === "string" ? v.apiKey : "",
      model: typeof v.model === "string" && v.model ? v.model : DEFAULT_TTS.model,
      voice: typeof v.voice === "string" && v.voice ? v.voice : DEFAULT_TTS.voice,
    };
  } catch {
    return { ...DEFAULT_TTS };
  }
}

export function saveTtsConfig(cfg: TtsConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

let audioEl: HTMLAudioElement | null = null;

/** 停止当前朗读（两种引擎都停） */
export function stopSpeaking() {
  try {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* ignore */
    }
    audioEl = null;
  }
}

/** 是否正在朗读 */
export function isSpeaking(): boolean {
  try {
    if (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) return true;
  } catch {
    /* ignore */
  }
  return !!audioEl && !audioEl.paused;
}

/** 朗读文本；返回 Promise，出错时 reject（调用方展示提示） */
export async function speak(text: string, cfg: TtsConfig): Promise<void> {
  const t = text.trim().slice(0, 3000);
  if (!t) return;
  stopSpeaking();
  if (cfg.engine === "openai") {
    if (!cfg.apiKey) throw new Error("未配置 TTS 接口 Key（设置 → 朗读 TTS）");
    const base = cfg.apiBase.replace(/\/+$/, "");
    let res: Response;
    try {
      res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.model || "tts-1", voice: cfg.voice || "alloy", input: t }),
      });
    } catch (e) {
      throw new Error(`TTS 接口请求失败：${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) throw new Error(`TTS 接口错误 HTTP ${res.status}`);
    const blob = await res.blob();
    audioEl = new Audio(URL.createObjectURL(blob));
    try {
      await audioEl.play();
    } catch (e) {
      audioEl = null;
      throw new Error(`播放失败：${e instanceof Error ? e.message : e}`);
    }
    return;
  }
  // 系统内置
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    throw new Error("当前环境不支持系统朗读，请在设置里改用 OpenAI 兼容接口");
  }
  const u = new SpeechSynthesisUtterance(t);
  u.lang = /[\u4e00-\u9fff]/.test(t) ? "zh-CN" : "en-US";
  speechSynthesis.speak(u);
}
