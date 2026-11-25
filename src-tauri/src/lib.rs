//! NotePP — Tauri 后端入口。
//!
//! 文件打开链路：
//! - Windows/Linux 冷启动：解析 argv 中的文件/文件夹路径
//! - Windows/Linux 已运行（单实例）：tauri-plugin-single-instance 转发新实例的 argv
//! - macOS：RunEvent::Opened（Finder 双击 / "打开方式"）
//! - 全部统一：写入 OpenedUrls 状态 + 发出 `open-files` 事件给前端
//!   （冷启动竞态由前端启动时 `opened_urls` 命令兜底消费）

mod ai;
mod commands;

use std::path::PathBuf;
use std::sync::Mutex;

/// 待打开的文件/文件夹路径（前端启动时 drain 一次）
struct OpenedUrls(Mutex<Vec<String>>);

#[tauri::command]
fn opened_urls(app: tauri::AppHandle) -> Vec<String> {
    use tauri::Manager;
    let state = app.state::<OpenedUrls>();
    let mut list = state.0.lock().unwrap();
    std::mem::take(&mut *list)
}

/// 把一批路径写入状态并广播给前端
fn emit_open_paths(target: &tauri::AppHandle, paths: Vec<String>) {
    use tauri::{Emitter, Manager};
    if paths.is_empty() {
        return;
    }
    let state = target.state::<OpenedUrls>();
    if let Ok(mut list) = state.0.lock() {
        list.extend(paths.iter().cloned());
    }
    let _ = target.emit("open-files", &paths);
}

/// 解析 argv → 文件/文件夹路径（跳过程序名与 `-` 开头的开关，兼容 file:// URL）
fn extract_file_paths(argv: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for raw in argv.iter().skip(1) {
        if raw.starts_with('-') {
            continue;
        }
        if let Ok(url) = url::Url::parse(raw) {
            if let Ok(path) = url.to_file_path() {
                push_unique(&mut out, &path);
            }
            continue;
        }
        push_unique(&mut out, &PathBuf::from(raw));
    }
    out
}

fn push_unique(out: &mut Vec<String>, path: &PathBuf) {
    let s = path.to_string_lossy().to_string();
    if !out.contains(&s) {
        out.push(s);
    }
}

/// 移动端（Android/iOS）入口：Tauri 2 的 Android 构建要求此标记
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(OpenedUrls(Mutex::new(vec![])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // 桌面端：单实例 + 二次启动的文件参数转发
    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let args: Vec<String> = argv.iter().map(|s| s.to_string()).collect();
        emit_open_paths(app, extract_file_paths(&args));
    }));

    builder
        .invoke_handler(tauri::generate_handler![
            commands::read_text_file,
            commands::write_text_file,
            commands::list_dir,
            commands::file_info,
            commands::read_file_chunk,
            commands::copy_media_file,
            commands::save_image_b64,
            commands::read_file_base64,
            commands::search_in_folder,
            commands::path_is_dir,
            commands::make_dir,
            commands::rename_path,
            commands::delete_path,
            commands::reveal_in_os,
            commands::open_path_default,
            commands::gist_upload,
            commands::gist_download,
            opened_urls,
            ai::ai_chat,
            ai::ai_models,
            ai::ai_chat_stream,
            ai::ai_image,
            ai::check_update
        ])
        .setup(|app| {
            // Windows/Linux 冷启动：双击文件 / 右键"打开方式"会把路径放进 argv
            let argv: Vec<String> = std::env::args().collect();
            emit_open_paths(app.handle(), extract_file_paths(&argv));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS：Finder 双击 / "打开方式" 事件（文件路径不在 argv 里）
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect::<Vec<_>>();
                emit_open_paths(app, paths);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
