use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub alias: String,
    pub port: u16,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            alias: names::Generator::default()
                .next()
                .unwrap_or_else(|| "Unknown-User".to_string()),
            port: 3030,
        }
    }
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    // app_config_dir() is part of the path manager in Tauri
    let config_path_res = app.path().app_config_dir();

    if let Ok(config_dir) = config_path_res {
        let config_path = config_dir.join("settings.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
    }

    let config = AppConfig::default();
    // Try to save the default config immediately
    let _ = save_config(app, &config);
    config
}

pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }

    let config_path = config_dir.join("settings.json");
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}
