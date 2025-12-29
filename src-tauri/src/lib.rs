use tauri::{Emitter, Manager};
use std::env;

#[tauri::command]
fn get_cli_args() -> Vec<String> {
    env::args().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![get_cli_args])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Emitir evento con los argumentos de línea de comandos
            let args: Vec<String> = env::args().collect();
            if args.len() > 1 {
                // El primer argumento es el ejecutable, los siguientes son archivos
                let files: Vec<String> = args.into_iter().skip(1).collect();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("open-file-from-cli", files);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
