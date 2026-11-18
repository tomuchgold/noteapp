//! NotePP — Tauri 后端入口。

mod ai;
mod commands;

/// 移动端（Android/iOS）入口：Tauri 2 的 Android 构建要求此标记
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_text_file,
            commands::write_text_file,
            commands::list_dir,
            commands::file_info,
            commands::read_file_chunk,
            commands::copy_media_file,
            commands::search_in_folder,
            ai::ai_chat,
            ai::ai_models,
            ai::ai_chat_stream,
            ai::check_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
