//! NotePP — Tauri 后端入口。

mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_text_file,
            commands::write_text_file,
            commands::list_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
