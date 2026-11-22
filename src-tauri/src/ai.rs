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

// ---------- 图片生成（OpenAI 兼容 /images/generations） ----------

#[derive(Deserialize)]
pub struct AiImageRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    #[serde(default = "default_image_n")]
    pub n: u32,
    /// 可选：1K / 2K / 4K（Agnes）或 1024x1024（OpenAI），空则不带 size 字段
    #[serde(default)]
    pub size: Option<String>,
}

fn default_image_n() -> u32 {
    1
}

#[derive(Serialize)]
pub struct AiImageResult {
    pub urls: Vec<String>,
    pub model: String,
}

/// 调用 OpenAI 兼容的 images/generations；b64_json 结果自动转 data URL
#[tauri::command]
pub async fn ai_image(req: AiImageRequest) -> Result<AiImageResult, String> {
    if req.base_url.trim().is_empty() {
        return Err("未配置 API 地址（Base URL）".into());
    }
    if req.api_key.trim().is_empty() {
        return Err("未配置 API Key，请到「AI 设置」中填写".into());
    }
    if req.model.trim().is_empty() {
        return Err("未配置生图模型".into());
    }
    if req.prompt.trim().is_empty() {
        return Err("图片描述为空".into());
    }

    let mut body = serde_json::json!({
        "model": req.model,
        "prompt": req.prompt,
        "n": req.n.max(1).min(4),
    });
    if let Some(s) = req.size.as_deref() {
        if !s.trim().is_empty() {
            body["size"] = serde_json::json!(s.trim());
        }
    }

    let resp = client()?
        .post(endpoint(&req.base_url, "images/generations"))
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

    let mut urls = Vec::new();
    if let Some(arr) = value["data"].as_array() {
        for item in arr {
            if let Some(u) = item["url"].as_str() {
                urls.push(u.to_string());
            } else if let Some(b) = item["b64_json"].as_str() {
                urls.push(format!("data:image/png;base64,{}", b));
            }
        }
    }
    if urls.is_empty() {
        return Err(format!("API 未返回图片数据：{}", truncate(&text, 300)));
    }

    Ok(AiImageResult {
        urls,
        model: req.model,
    })
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

#[derive(Clone, Serialize)]
pub struct AiChunk {
    /// 请求标识，前端用它对上自己的监听
    pub id: String,
    pub delta: String,
}

#[derive(Clone, Serialize)]
pub struct AiStreamEnd {
    pub id: String,
    pub model: String,
    pub tokens: Option<u64>,
}

#[derive(Clone, Serialize)]
pub struct AiStreamError {
    pub id: String,
    pub message: String,
}

/// 流式对话：通过 SSE 逐段 emit `ai://chunk`，结束时 emit `ai://done`
#[tauri::command]
pub async fn ai_chat_stream(
    app: tauri::AppHandle,
    id: String,
    req: AiChatRequest,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    if req.base_url.trim().is_empty() {
        return Err("未配置 API 地址（Base URL）".into());
    }
    if req.api_key.trim().is_empty() {
        return Err("未配置 API Key，请到「AI 设置」中填写".into());
    }

    let body = serde_json::json!({
        "model": req.model,
        "messages": req
            .messages
            .iter()
            .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
            .collect::<Vec<_>>(),
        "temperature": req.temperature,
        "stream": true
    });

    let resp = client()?
        .post(endpoint(&req.base_url, "chat/completions"))
        .bearer_auth(req.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败：{}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let msg = format!("HTTP {}：{}", status.as_u16(), truncate(&text, 400));
        let _ = app.emit(
            "ai://error",
            AiStreamError {
                id: id.clone(),
                message: msg.clone(),
            },
        );
        return Err(msg);
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut tokens: Option<u64> = None;

    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let msg = format!("读取流失败：{}", e);
                let _ = app.emit(
                    "ai://error",
                    AiStreamError {
                        id: id.clone(),
                        message: msg.clone(),
                    },
                );
                return Err(msg);
            }
        };
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                let _ = app.emit(
                    "ai://done",
                    AiStreamEnd {
                        id: id.clone(),
                        model: req.model.clone(),
                        tokens,
                    },
                );
                return Ok(());
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            if let Some(t) = v["usage"]["total_tokens"].as_u64() {
                tokens = Some(t);
            }
            if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                if !delta.is_empty() {
                    let _ = app.emit(
                        "ai://chunk",
                        AiChunk {
                            id: id.clone(),
                            delta: delta.to_string(),
                        },
                    );
                }
            }
        }
    }

    let _ = app.emit(
        "ai://done",
        AiStreamEnd {
            id: id.clone(),
            model: req.model.clone(),
            tokens,
        },
    );
    Ok(())
}

// ---------- 更新检查 ----------

#[derive(Serialize)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    pub url: String,
    pub notes: String,
    pub published_at: String,
}

fn ver_parts(v: &str) -> Vec<u64> {
    v.trim_start_matches('v')
        .split(['.', '-'])
        .map(|p| p.parse::<u64>().unwrap_or(0))
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let a = ver_parts(latest);
    let b = ver_parts(current);
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// 检查最新版本。api_url 默认 GitHub Releases API（私有仓库需传 token）
#[tauri::command]
pub async fn check_update(
    current: String,
    api_url: Option<String>,
    token: Option<String>,
) -> Result<UpdateInfo, String> {
    let url = api_url.unwrap_or_else(|| {
        "https://api.github.com/repos/tomuchgold/noteapp/releases/latest".to_string()
    });
    let mut rb = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "NotePP");
    if let Some(t) = token {
        if !t.trim().is_empty() {
            rb = rb.bearer_auth(t.trim());
        }
    }
    let resp = rb.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}：{}", status.as_u16(), truncate(&text, 300)));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| format!("响应不是合法 JSON：{}", truncate(&text, 200)))?;
    let latest = v["tag_name"]
        .as_str()
        .or_else(|| v["version"].as_str())
        .unwrap_or("")
        .to_string();
    if latest.is_empty() {
        return Err("响应中缺少 tag_name 字段".into());
    }
    Ok(UpdateInfo {
        newer: is_newer(&latest, &current),
        current,
        latest,
        url: v["html_url"].as_str().unwrap_or("https://github.com/tomuchgold/noteapp/releases").to_string(),
        notes: v["body"].as_str().unwrap_or("").chars().take(2000).collect(),
        published_at: v["published_at"].as_str().unwrap_or("").to_string(),
    })
}
