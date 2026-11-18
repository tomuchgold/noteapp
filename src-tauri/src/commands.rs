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

/// 目录条目（文件夹浏览树）
#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 列出目录内容：目录在前、按名称排序；隐藏文件（. 开头）过滤
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let rd = std::fs::read_dir(&path).map_err(|e| format!("读取目录失败：{}", e))?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for item in rd.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let ft = match item.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        entries.push(DirEntry {
            name,
            path: item.path().to_string_lossy().to_string(),
            is_dir: ft.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// 文件大小 / 修改时间查询（打开前判断是否进入大文件模式；外部变更监听用）
#[derive(Serialize, Deserialize)]
pub struct FileInfo {
    pub size: u64,
    /// 最后修改时间（Unix 秒；无法取得时为 0）
    pub mtime: i64,
}

#[tauri::command]
pub fn file_info(path: String) -> Result<FileInfo, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("读取文件信息失败：{}", e))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(FileInfo { size: meta.len(), mtime })
}

/// 拷贝媒体/附件文件到文档同目录的 media/ 下，返回相对引用路径（media/xxx.ext）。
/// 同名冲突时自动加序号（xxx-1.ext）。拖拽多媒体入编辑区时使用。
#[tauri::command]
pub fn copy_media_file(src: String, doc_path: String) -> Result<String, String> {
    let src_path = Path::new(&src);
    if !src_path.exists() {
        return Err(format!("文件不存在：{}", src));
    }
    let doc_dir = Path::new(&doc_path)
        .parent()
        .ok_or_else(|| "无法确定文档目录".to_string())?;
    let media_dir = doc_dir.join("media");
    fs::create_dir_all(&media_dir).map_err(|e| format!("创建 media 目录失败：{}", e))?;

    let name = src_path
        .file_name()
        .map(|n| n.to_os_string())
        .ok_or_else(|| "无法获取文件名".to_string())?;
    let file_stem = src_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let ext = src_path
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();

    let mut dest = media_dir.join(&name);
    let mut seq = 1;
    while dest.exists() {
        dest = media_dir.join(format!("{}-{}{}", file_stem, seq, ext));
        seq += 1;
    }
    fs::copy(src_path, &dest).map_err(|e| format!("复制失败：{}", e))?;
    Ok(format!("media/{}", dest.file_name().unwrap().to_string_lossy()))
}

/// 跨文件夹查找的命中行
#[derive(serde::Serialize)]
pub struct SearchHit {
    pub path: String,
    /// 1 基行号
    pub line: usize,
    /// 该行文本（超长截断）
    pub text: String,
    /// 行内首个命中列（1 基，字符数）
    pub col: usize,
}

/// 跨文件夹查找参数
#[derive(serde::Deserialize)]
pub struct SearchRequest {
    pub root: String,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// 跳过的目录（构建产物 / 依赖 / 版本库）
const SKIP_DIRS: [&str; 8] = [
    "node_modules", ".git", "target", "dist", "build", ".next", "__pycache__", ".venv",
];

/// 允许搜索的文本后缀（白名单，避免读二进制）
const TEXT_EXTS: [&str; 44] = [
    "txt", "md", "markdown", "log", "js", "mjs", "cjs", "jsx", "ts", "tsx", "html", "htm",
    "css", "scss", "less", "json", "jsonc", "py", "rs", "c", "h", "cpp", "cc", "cxx", "hpp",
    "java", "go", "sql", "xml", "svg", "yml", "yaml", "sh", "bash", "zsh", "lua", "pas", "f90",
    "f", "pl", "rb", "vue", "ini", "toml",
];

fn is_text_ext(path: &Path) -> bool {
    match path.extension() {
        Some(e) => TEXT_EXTS.contains(&e.to_string_lossy().to_lowercase().as_str()),
        None => false,
    }
}

/// 在文件夹中查找：递归遍历 + 后缀白名单 + 逐行匹配
#[tauri::command]
pub fn search_in_folder(req: SearchRequest) -> Result<Vec<SearchHit>, String> {
    use std::collections::VecDeque;

    if req.query.is_empty() {
        return Ok(Vec::new());
    }
    let root = std::path::PathBuf::from(&req.root);
    if !root.is_dir() {
        return Err(format!("不是有效目录：{}", req.root));
    }

    // 正则或普通文本匹配器
    let re = if req.regex {
        let pattern = if req.whole_word {
            format!(r"\b(?:{})\b", req.query)
        } else {
            req.query.clone()
        };
        let builder = regex::RegexBuilder::new(&pattern)
            .case_insensitive(!req.case_sensitive)
            .size_limit(4 * 1024 * 1024)
            .build()
            .map_err(|e| format!("正则无效：{}", e))?;
        Some(builder)
    } else {
        None
    };
    let needle = req.query.to_lowercase();

    let mut hits: Vec<SearchHit> = Vec::new();
    const MAX_HITS: usize = 2000;
    let mut queue: VecDeque<std::path::PathBuf> = VecDeque::new();
    queue.push_back(root);

    while let Some(dir) = queue.pop_front() {
        let rd = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for item in rd.flatten() {
            if hits.len() >= MAX_HITS {
                return Ok(hits);
            }
            let p = item.path();
            let name = item.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ft = match item.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    queue.push_back(p);
                }
                continue;
            }
            if !is_text_ext(&p) {
                continue;
            }
            // 单文件上限 4MB，避免卡死
            let meta = match item.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.len() > 4 * 1024 * 1024 {
                continue;
            }
            let bytes = match fs::read(&p) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let content = match String::from_utf8(bytes) {
                Ok(c) => c,
                Err(_) => continue, // 非 UTF-8 跳过（跨平台查找以 UTF-8 为准）
            };
            let display = p.to_string_lossy().to_string();
            for (idx, line) in content.lines().enumerate() {
                if line.len() > 4000 {
                    continue;
                }
                let matched = match &re {
                    Some(r) => r.is_match(line),
                    None => {
                        if req.case_sensitive {
                            if req.whole_word {
                                find_whole_word(line, &req.query).is_some()
                            } else {
                                line.contains(&req.query)
                            }
                        } else if req.whole_word {
                            find_whole_word(&line.to_lowercase(), &needle).is_some()
                        } else {
                            line.to_lowercase().contains(&needle)
                        }
                    }
                };
                if !matched {
                    continue;
                }
                let col = match &re {
                    Some(r) => r.find(line).map(|m| line[..m.start()].chars().count() + 1).unwrap_or(1),
                    None => {
                        let hay = if req.case_sensitive { line.to_string() } else { line.to_lowercase() };
                        let q = if req.case_sensitive { req.query.clone() } else { needle.clone() };
                        hay.find(&q).map(|i| hay[..i].chars().count() + 1).unwrap_or(1)
                    }
                };
                let mut text = line.trim_end().to_string();
                if text.chars().count() > 200 {
                    text = text.chars().take(200).collect::<String>() + "…";
                }
                hits.push(SearchHit { path: display.clone(), line: idx + 1, text, col });
                if hits.len() >= MAX_HITS {
                    return Ok(hits);
                }
            }
        }
    }
    Ok(hits)
}

/// 全字匹配（ASCII 边界判定，中文按非单词字符处理）
fn find_whole_word(hay: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return None;
    }
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let mut start = 0;
    while let Some(i) = hay[start..].find(needle) {
        let abs = start + i;
        let before_ok = abs == 0 || !hay[..abs].chars().next_back().map(is_word).unwrap_or(false);
        let end = abs + needle.len();
        let after_ok = end >= hay.len() || !hay[end..].chars().next().map(is_word).unwrap_or(false);
        if before_ok && after_ok {
            return Some(abs);
        }
        start = abs + needle.len().max(1);
        if start >= hay.len() {
            break;
        }
    }
    None
}

/// 分块读取：从 offset 起读 length 字节，按 UTF-8 容错解码。
/// 用于大文件模式（>8MB），避免一次性把整个文件读进内存。
#[tauri::command]
pub fn read_file_chunk(path: String, offset: u64, length: u64) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(&path).map_err(|e| format!("打开失败：{}", e))?;
    let total = file.metadata().map(|m| m.len()).map_err(|e| e.to_string())?;
    if offset >= total {
        return Ok(String::new());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("定位失败：{}", e))?;
    let want = length.min(total - offset) as usize;
    let mut buf = vec![0u8; want];
    let mut read = 0usize;
    while read < want {
        match file.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(e) => return Err(format!("读取失败：{}", e)),
        }
    }
    buf.truncate(read);

    // 块首若落在 UTF-8 续字节上，跳到字符边界
    let mut start = 0usize;
    while start < buf.len() && (buf[start] & 0xC0) == 0x80 {
        start += 1;
    }
    // 块尾若截断多字节字符，回退到完整字符
    let mut end = buf.len();
    let mut back = 0;
    while end > start && back < 4 && (buf[end - 1] & 0xC0) == 0x80 {
        end -= 1;
        back += 1;
    }
    if end > start && back < 4 {
        // 检查末尾字符是否完整（简单校验：能解码即为完整）
        if std::str::from_utf8(&buf[start..end]).is_err() && end > start {
            let mut e = end;
            while e > start {
                e -= 1;
                if (buf[e] & 0xC0) != 0x80 && std::str::from_utf8(&buf[start..e]).is_ok() {
                    end = e;
                    break;
                }
            }
        }
    }

    Ok(String::from_utf8_lossy(&buf[start..end]).to_string())
}
