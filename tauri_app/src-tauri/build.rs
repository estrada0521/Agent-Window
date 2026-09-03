fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_external_url",
            "show_chat_header_menu",
            "show_appearance_menu",
            "reset_window_geometry",
            "compact_window_geometry",
            "set_always_on_top",
            "mini_window_geometry",
        ]),
    ))
    .expect("failed to run Tauri build script")
}
