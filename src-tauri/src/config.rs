use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use tracing::{info, warn, error};

use crate::constants;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub app: AppConfig,
    pub security: SecurityConfig,
    pub background: BackgroundConfig,
    // DEVOPS-003: crash-reporting. Секция опциональна — без неё в TOML
    // (или с пустым dsn) Sentry не инициализируется и ничего не отправляет.
    #[serde(default)]
    pub sentry: SentryConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SentryConfig {
    /// DSN проекта Sentry (публичный ключ, не секрет).
    /// Пустая строка = crash-reporting выключен.
    #[serde(default)]
    pub dsn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub profile: String,
    pub name: String,
    pub version: String,
    pub debug: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub rate_limit_strict: u32,
    pub rate_limit_moderate: u32,
    pub rate_limit_lenient: u32,
    pub pbkdf2_iterations: u32,
    pub session_timeout: u32,
    pub autolock_timeout: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundConfig {
    pub license_check_interval: u32,
    pub sync_interval: u32,
    pub stuffer_poll_interval: u32,
    pub fulfillment_check_interval: u32,
    pub risk_check_interval: u32,
    pub quarantine_cleanup_interval: u32,
    pub catalog_update_interval: u32,
}

pub fn load_config(config_path: &Path) -> Result<Config, String> {
    info!(
        config_path = %config_path.display(),
        "Loading configuration from TOML"
    );
    
    if !config_path.exists() {
        let msg = format!(
            "Configuration file not found: {}",
            config_path.display()
        );
        error!("{}", msg);
        return Err(msg);
    }
    
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!(
            "Failed to read configuration file: {}",
            e
        ))?;
    
    let mut config: Config = toml::from_str(&content)
        .map_err(|e| format!(
            "Failed to parse TOML configuration: {}",
            e
        ))?;
    
    apply_env_overrides(&mut config);
    validate_config(&config)?;
    
    info!(
        profile = %config.app.profile,
        "Configuration loaded successfully"
    );
    
    Ok(config)
}

fn apply_env_overrides(config: &mut Config) {
    // DEVOPS-005: env-override профиля/дебага только в debug-сборках —
    // release всегда остаётся production, сколько ни выставляй VAULTBASE_PROFILE
    if cfg!(debug_assertions) {
        if let Ok(profile) = std::env::var("VAULTBASE_PROFILE") {
            config.app.profile = profile;
            info!("Profile overridden via VAULTBASE_PROFILE");
        }

        if std::env::var("VAULTBASE_DEBUG").is_ok() {
            config.app.debug = true;
            info!("Debug mode enabled via VAULTBASE_DEBUG");
        }
    }
}

fn validate_config(config: &Config) -> Result<(), String> {
    match config.app.profile.as_str() {
        "dev" | "staging" | "production" => {},
        _ => return Err(format!(
            "Invalid profile: {}. Must be dev, staging, or production",
            config.app.profile
        )),
    }
    
    if config.security.rate_limit_strict == 0 {
        return Err("rate_limit_strict must be > 0".to_string());
    }
    
    if config.security.pbkdf2_iterations < 100_000 {
        warn!(
            iterations = config.security.pbkdf2_iterations,
            "PBKDF2 iterations is low - consider increasing for security"
        );
    }
    
    Ok(())
}

pub fn get_default_config(profile: &str) -> Config {
    match profile {
        "dev" => Config {
            sentry: SentryConfig::default(),
            app: AppConfig {
                profile: "dev".to_string(),
                name: "VaultBase".to_string(),
                version: "2.11.3".to_string(),
                debug: true,
            },
            security: SecurityConfig {
                rate_limit_strict: 5,
                rate_limit_moderate: 30,
                rate_limit_lenient: 100,
                pbkdf2_iterations: 600_000,
                session_timeout: 3600,
                autolock_timeout: 30,
            },
            background: BackgroundConfig {
                license_check_interval: 60,
                sync_interval: 60,
                stuffer_poll_interval: 300,
                fulfillment_check_interval: 1800,
                risk_check_interval: 300,
                quarantine_cleanup_interval: 1800,
                catalog_update_interval: 3600,
            },
        },
        
        "staging" => Config {
            sentry: SentryConfig::default(),
            app: AppConfig {
                profile: "staging".to_string(),
                name: "VaultBase".to_string(),
                version: "2.11.3".to_string(),
                debug: false,
            },
            security: SecurityConfig {
                rate_limit_strict: 5,
                rate_limit_moderate: 30,
                rate_limit_lenient: 100,
                pbkdf2_iterations: 600_000,
                session_timeout: 3600,
                autolock_timeout: 30,
            },
            background: BackgroundConfig {
                license_check_interval: 60,
                sync_interval: 60,
                stuffer_poll_interval: 300,
                fulfillment_check_interval: 1800,
                risk_check_interval: 300,
                quarantine_cleanup_interval: 1800,
                catalog_update_interval: 3600,
            },
        },
        
        _ => Config {
            sentry: SentryConfig::default(),
            app: AppConfig {
                profile: "production".to_string(),
                name: "VaultBase".to_string(),
                version: "2.11.3".to_string(),
                debug: false,
            },
            security: SecurityConfig {
                rate_limit_strict: 5,
                rate_limit_moderate: 30,
                rate_limit_lenient: 100,
                pbkdf2_iterations: constants::PBKDF2_ITERATIONS,
                session_timeout: 3600,
                autolock_timeout: 30,
            },
            background: BackgroundConfig {
                license_check_interval: 60,
                sync_interval: 60,
                stuffer_poll_interval: 300,
                fulfillment_check_interval: 1800,
                risk_check_interval: 300,
                quarantine_cleanup_interval: 1800,
                catalog_update_interval: 3600,
            },
        },
    }
}

pub fn get_config_path(profile: &str) -> PathBuf {
    if let Ok(config_dir) = std::env::var("VAULTBASE_CONFIG_DIR") {
        PathBuf::from(config_dir).join(format!("VaultBase.{}.toml", profile))
    } else {
        PathBuf::from(format!("VaultBase.{}.toml", profile))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_get_default_config_dev() {
        let config = get_default_config("dev");
        assert_eq!(config.app.profile, "dev");
        assert!(config.app.debug);
    }
    
    #[test]
    fn test_get_default_config_production() {
        let config = get_default_config("production");
        assert_eq!(config.app.profile, "production");
        assert!(!config.app.debug);
    }
    
    #[test]
    fn test_validate_config_valid() {
        let config = get_default_config("dev");
        assert!(validate_config(&config).is_ok());
    }
    
    #[test]
    fn test_invalid_profile() {
        let mut config = get_default_config("dev");
        config.app.profile = "invalid".to_string();
        assert!(validate_config(&config).is_err());
    }
}
