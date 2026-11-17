//! AI 调用：所有厂商统一走 OpenAI 兼容的 /chat/completions。
//! 放在 Rust 侧的原因：WebView 直连第三方 API 会被 CORS 拦截，且不易自定义超时。

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct AiChatRequest {
    /// 形如 https://api.deepseek.com/v1（末尾斜杠可有可无）
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<AiMessage>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
}

fn default_temperature() -> f32 {
    0.3
}

#[derive(Serialize)]
pub struct AiChatResult {
    pub content: String,
    pub model: String,
    pub tokens: Option<u64>,
}

fn truncate(s: &str, max: usize) -> String {
    let mut out: String = s.chars().take(max).collect();
    if s.chars().count() > max {
        out.push('…');
    }
    out
}

fn endpoint(base: &str, suffix: &str) -> String {
    format!("{}/{}", base.trim().trim_end_matches('/'), suffix)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("初始化网络客户端失败：{}", e))
}

/// 调用 OpenAI 兼容的 chat/completions
#[tauri::command]
pub async fn ai_chat(req: AiChatRequest) -> Result<AiChatResult, String> {
    if req.base_url.trim().is_empty() {
        return Err("未配置 API 地址（Base URL）".into());
    }
    if req.api_key.trim().is_empty() {
        return Err("未配置 API Key，请到「AI 设置」中填写".into());
    }
    if req.model.trim().is_empty() {
        return Err("未配置模型名称".into());
    }

    let body = serde_json::json!({
        "model": req.model,
        "messages": req
            .messages
            .iter()
            .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
            .collect::<Vec<_>>(),
        "temperature": req.temperature,
        "stream": false
    });

    let resp = client()?
        .post(endpoint(&req.base_url, "chat/completions"))
        .bearer_auth(req.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败：{}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败：{}", e))?;

    if !status.is_success() {
        return Err(format!("HTTP {}：{}", status.as_u16(), truncate(&text, 400)));
    }

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| format!("响应不是合法 JSON：{}", truncate(&text, 300)))?;

    // 兼容少数网关把内容放在 content 数组里的情况
    let content = value["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| {
            value["choices"][0]["message"]["content"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|b| b["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("")
                })
        })
        .unwrap_or_default();

    if content.trim().is_empty() {
        return Err(format!("模型返回为空：{}", truncate(&text, 300)));
    }

    Ok(AiChatResult {
        content,
        model: req.model,
        tokens: value["usage"]["total_tokens"].as_u64(),
    })
}

/// 拉取可用模型列表（GET /models），供设置面板下拉选择
#[tauri::command]
pub async fn ai_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("未配置 API 地址".into());
    }
    let resp = client()?
        .get(endpoint(&base_url, "models"))
        .bearer_auth(api_key.trim())
        .send()
        .await
        .map_err(|e| format!("请求失败：{}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败：{}", e))?;

    if !status.is_success() {
        return Err(format!("HTTP {}：{}", status.as_u16(), truncate(&text, 300)));
    }

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| format!("响应不是合法 JSON：{}", truncate(&text, 200)))?;

    let mut models: Vec<String> = value["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    if models.is_empty() {
        return Err("该服务未返回模型列表，请手动填写模型名".into());
    }
    Ok(models)
}
