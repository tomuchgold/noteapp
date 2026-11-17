//! NotePP Tauri 命令：文件读写（编码检测/转码/换行符处理）。

use encoding_rs::{GBK, UTF_16BE, UTF_16LE};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// 读取结果：内容已统一为 UTF-8（前端 CodeMirror 只处理 UTF-8）
#[derive(Serialize, Deserialize)]
pub struct ReadResult {
    pub content: String,
    /// 实际使用的编码：UTF-8 / GBK / UTF-16LE / UTF-16BE
    pub encoding: String,
    /// 是否带 BOM
    pub bom: bool,
    /// 换行符：LF / CRLF / CR / MIXED
    pub eol: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize)]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
    /// 保存时使用的编码：UTF-8 / GBK / UTF-16LE / UTF-16BE
    pub encoding: String,
    pub bom: bool,
    /// LF / CRLF
    pub eol: String,
}

fn detect_eol(bytes: &[u8]) -> String {
    let has_crlf = bytes.windows(2).any(|w| w == b"\r\n");
    // 独立的 \n（前面不是 \r）
    let has_lf = bytes
        .iter()
        .enumerate()
        .any(|(i, b)| *b == b'\n' && (i == 0 || bytes[i - 1] != b'\r'));
    let lone_cr = bytes
        .iter()
        .enumerate()
        .any(|(i, b)| *b == b'\r' && (i + 1 == bytes.len() || bytes[i + 1] != b'\n'));

    match (has_crlf, has_lf, lone_cr) {
        (true, false, false) => "CRLF".into(),
        (false, true, false) => "LF".into(),
        (false, false, true) => "CR".into(),
        _ => "MIXED".into(),
    }
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<ReadResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在：{}", path));
    }
    let bytes = fs::read(p).map_err(|e| format!("读取失败：{}", e))?;
    let size = bytes.len() as u64;

    // 1. BOM 检测
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let text = String::from_utf8_lossy(&bytes[3..]).into_owned();
        return Ok(ReadResult {
            content: text,
            encoding: "UTF-8".into(),
            bom: true,
            eol: detect_eol(&bytes[3..]),
            size,
        });
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (content, _, had_errors) = UTF_16LE.decode(&bytes[2..]);
        if had_errors {
            return Err("UTF-16LE 解码失败".into());
        }
        return Ok(ReadResult {
            content: content.into_owned(),
            encoding: "UTF-16LE".into(),
            bom: true,
            eol: "MIXED".into(), // UTF-16 换行符检测略
            size,
        });
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (content, _, had_errors) = UTF_16BE.decode(&bytes[2..]);
        if had_errors {
            return Err("UTF-16BE 解码失败".into());
        }
        return Ok(ReadResult {
            content: content.into_owned(),
            encoding: "UTF-16BE".into(),
            bom: true,
            eol: "MIXED".into(),
            size,
        });
    }

    // 2. 无 BOM：先按严格 UTF-8 尝试，失败再按 GBK 解码
    if let Ok(text) = std::str::from_utf8(&bytes) {
        return Ok(ReadResult {
            content: text.to_string(),
            encoding: "UTF-8".into(),
            bom: false,
            eol: detect_eol(&bytes),
            size,
        });
    }
    let (content, _, had_errors) = GBK.decode(&bytes);
    if had_errors {
        return Err("无法识别的文件编码（非 UTF-8 / GBK / UTF-16）".into());
    }
    Ok(ReadResult {
        content: content.into_owned(),
        encoding: "GBK".into(),
        bom: false,
        eol: detect_eol(&bytes),
        size,
    })
}

#[tauri::command]
pub fn write_text_file(req: WriteRequest) -> Result<(), String> {
    // 统一换行符：先把内容归一化为 LF，再按目标 eol 展开
    let normalized = req.content.replace("\r\n", "\n").replace('\r', "\n");
    let content = match req.eol.as_str() {
        "CRLF" => normalized.replace('\n', "\r\n"),
        _ => normalized,
    };

    let bytes: Vec<u8> = match req.encoding.as_str() {
        "GBK" => {
            let (enc, _, _) = GBK.encode(&content);
            enc.into_owned()
        }
        "UTF-16LE" => {
            let (enc, _, _) = UTF_16LE.encode(&content);
            enc.into_owned()
        }
        "UTF-16BE" => {
            let (enc, _, _) = UTF_16BE.encode(&content);
            enc.into_owned()
        }
        _ => content.into_bytes(),
    };

    let mut out = Vec::new();
    if req.bom {
        match req.encoding.as_str() {
            "UTF-8" => out.extend_from_slice(&[0xEF, 0xBB, 0xBF]),
            "UTF-16LE" => out.extend_from_slice(&[0xFF, 0xFE]),
            "UTF-16BE" => out.extend_from_slice(&[0xFE, 0xFF]),
            _ => {}
        }
    }
    out.extend_from_slice(&bytes);

    if let Some(parent) = Path::new(&req.path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{}", e))?;
    }
    fs::write(&req.path, out).map_err(|e| format!("写入失败：{}", e))
}
