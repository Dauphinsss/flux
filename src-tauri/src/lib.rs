use tauri::{Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use std::env;
use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;
use serde::Serialize;
use rayon::prelude::*;

// Estado global para almacenar archivos pendientes
struct PendingFiles(Mutex<Vec<String>>);

#[derive(Serialize, Clone)]
struct PdfFileInfo {
    path: String,
    name: String,
    size: u64,
    modified: u64,
}

#[tauri::command]
fn get_cli_args() -> Vec<String> {
    env::args().collect()
}

#[tauri::command]
fn search_pdfs_in_directory(directory: String) -> Result<Vec<PdfFileInfo>, String> {
    let path = PathBuf::from(&directory);
    if !path.exists() {
        return Err("El directorio no existe".to_string());
    }

    // Recolectar todos los directorios a escanear primero (máximo 3 niveles)
    let mut dirs_to_scan = vec![(path.clone(), 0usize)];
    let mut all_dirs = Vec::new();

    while let Some((dir, depth)) = dirs_to_scan.pop() {
        if depth > 3 {
            continue;
        }
        all_dirs.push(dir.clone());

        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_dir() {
                        dirs_to_scan.push((entry.path(), depth + 1));
                    }
                }
            }
        }
    }

    // Escanear directorios en paralelo
    let pdf_files: Vec<PdfFileInfo> = all_dirs
        .par_iter()
        .flat_map(|dir| {
            let mut files = Vec::new();
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Ok(metadata) = entry.metadata() {
                        if metadata.is_file() {
                            if let Some(path_str) = entry.path().to_str() {
                                if path_str.to_lowercase().ends_with(".pdf") {
                                    if let Some(name) = entry.file_name().to_str() {
                                        let modified_secs = metadata.modified()
                                            .ok()
                                            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                                            .map(|d| d.as_secs())
                                            .unwrap_or(0);

                                        files.push(PdfFileInfo {
                                            path: path_str.to_string(),
                                            name: name.to_string(),
                                            size: metadata.len(),
                                            modified: modified_secs,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            files
        })
        .collect();

    Ok(pdf_files)
}

#[tauri::command]
fn get_common_directories() -> Vec<String> {
    let mut dirs = Vec::new();

    // Directorios comunes en Windows
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        let user_path = PathBuf::from(user_profile);

        // Documentos
        let documents = user_path.join("Documents");
        if documents.exists() {
            if let Some(path_str) = documents.to_str() {
                dirs.push(path_str.to_string());
            }
        }

        // Descargas
        let downloads = user_path.join("Downloads");
        if downloads.exists() {
            if let Some(path_str) = downloads.to_str() {
                dirs.push(path_str.to_string());
            }
        }

        // Escritorio
        let desktop = user_path.join("Desktop");
        if desktop.exists() {
            if let Some(path_str) = desktop.to_str() {
                dirs.push(path_str.to_string());
            }
        }
    }

    dirs
}

#[tauri::command]
fn take_pending_files(state: State<PendingFiles>) -> Vec<String> {
    let mut pending = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let files = pending.clone();
    pending.clear();
    files
}

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
    println!("DevTools opened");
}

fn extract_pdf_paths(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|arg| arg.to_lowercase().ends_with(".pdf"))
        .cloned()
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            println!("Single instance triggered with args: {:?}", args);

            // Cuando se intenta abrir otra instancia, recibimos los argumentos aquí
            let pdf_files = extract_pdf_paths(&args);

            println!("Extracted PDF files: {:?}", pdf_files);

            if !pdf_files.is_empty() {
                if let Some(window) = app.get_webview_window("main") {
                    println!("Focusing window and emitting open-files event");
                    // Enfocar la ventana existente
                    let _ = window.set_focus();
                    let _ = window.unminimize();
                    // Emitir evento con los archivos
                    let _ = window.emit("open-files", pdf_files.clone());
                    println!("Event emitted successfully with files: {:?}", pdf_files);
                } else {
                    println!("Window 'main' not found!");
                }
            } else {
                println!("No PDF files found in arguments");
            }
        }))
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            get_cli_args,
            take_pending_files,
            open_devtools,
            search_pdfs_in_directory,
            get_common_directories
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Registrar el deep-link para archivos PDF
            println!("Registering deep link...");
            if let Err(e) = app.deep_link().register("pdf") {
                println!("Failed to register deep link: {:?}", e);
            } else {
                println!("Deep link registered successfully!");
            }

            // Obtener argumentos de línea de comandos
            let args: Vec<String> = env::args().collect();
            println!("Initial CLI args: {:?}", args);

            let pdf_files = extract_pdf_paths(&args);
            println!("Extracted PDF files from CLI: {:?}", pdf_files);

            if !pdf_files.is_empty() {
                // Guardar archivos pendientes para cuando el frontend esté listo
                if let Some(state) = app.try_state::<PendingFiles>() {
                    if let Ok(mut pending) = state.0.lock() {
                        *pending = pdf_files.clone();
                        println!("Saved to pending files: {:?}", pdf_files);
                    }
                }

                // También emitir evento inmediatamente
                if let Some(window) = app.get_webview_window("main") {
                    println!("Emitting initial open-files event");
                    let _ = window.emit("open-files", pdf_files.clone());
                }
            }

            // Escuchar eventos de deep-link (cuando se abre un archivo asociado)
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                println!("Deep link event received!");
                let urls = event.urls();

                // Debug: imprimir URLs recibidas
                for url in urls {
                    println!("URL received: {}", url);

                    // Intentar convertir URL a path de archivo
                    if let Ok(path) = url.to_file_path() {
                        println!("Converted to path: {:?}", path);

                        if path.to_string_lossy().to_lowercase().ends_with(".pdf") {
                            let path_str = path.to_string_lossy().to_string();
                            println!("Opening PDF: {}", path_str);

                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.set_focus();
                                let _ = window.unminimize();
                                let _ = window.emit("open-files", vec![path_str]);
                            }
                        }
                    } else {
                        println!("Failed to convert URL to file path: {}", url);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
