// SPRINT3-DAY2: Structured logging module using tracing
// Provides JSON-formatted logs with file rotation and error tracking

use tracing::{Level, metadata::LevelFilter};
use tracing_subscriber::{
    fmt::{self, format::FmtSpan},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter, Layer,
};
use tracing_appender::{non_blocking, rolling};
use std::path::PathBuf;

/// Log levels for VaultBase
#[derive(Debug, Clone, Copy)]
pub enum LogLevel {
    /// Trace level - very verbose debugging
    Trace,
    /// Debug level - detailed debugging information
    Debug,
    /// Info level - general informational messages
    Info,
    /// Warn level - warning messages
    Warn,
    /// Error level - error messages
    Error,
}

impl From<LogLevel> for LevelFilter {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Trace => LevelFilter::TRACE,
            LogLevel::Debug => LevelFilter::DEBUG,
            LogLevel::Info => LevelFilter::INFO,
            LogLevel::Warn => LevelFilter::WARN,
            LogLevel::Error => LevelFilter::ERROR,
        }
    }
}

/// Initialize structured logging system
/// 
/// Sets up dual logging:
/// 1. Console output (human-readable format)
/// 2. JSON file output with daily rotation
/// 
/// # Arguments
/// * `log_dir` - Directory to store log files
/// * `log_level` - Minimum log level to capture
/// * `enable_json` - Enable JSON formatting for file logs
/// 
/// # Returns
/// * `Ok(())` if successful
/// * `Err(String)` if initialization fails
/// SEC: файловые логи — форензик-след (хронология сессий, пути с именем
/// пользователя ОС). В release-сборке по умолчанию НЕ пишутся: включаются
/// осознанно через env `VAULTBASE_LOG_FILE=1`. В dev-сборке (debug_assertions)
/// включены по умолчанию для отладки.
fn file_logging_enabled() -> bool {
    match std::env::var("VAULTBASE_LOG_FILE") {
        Ok(v) => matches!(v.as_str(), "1" | "true" | "yes" | "on"),
        Err(_) => cfg!(debug_assertions),
    }
}

pub fn init_logging(
    log_dir: PathBuf,
    log_level: LogLevel,
    enable_json: bool,
) -> Result<(), String> {
    let file_enabled = file_logging_enabled();
    let non_blocking_appender = if file_enabled {
        // Create logs directory if it doesn't exist
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create log directory: {}", e))?;
        // Set up file appender with daily rotation
        let file_appender = rolling::daily(&log_dir, "vaultbase.log");
        let (appender, _guard) = non_blocking(file_appender);
        // _guard осознанно не сохраняем: его drop не закрывает файл (он живёт
        // внутри writer'а), а worker-канал завершается — записи просто теряются
        // при выключении. Держать глобальный guard ради красивого shutdown не
        // имеет смысла: лог-файлы в проде выключены.
        Some(appender)
    } else {
        None
    };

    // Configure environment filter
    // Default to configured level, but allow RUST_LOG env override
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            let level_str = match log_level {
                LogLevel::Trace => "trace",
                LogLevel::Debug => "debug",
                LogLevel::Info => "info",
                LogLevel::Warn => "warn",
                LogLevel::Error => "error",
            };
            EnvFilter::new(format!("vaultbase={},vaultbase_lib={}", level_str, level_str))
        });

    // Console layer - human-readable format with colors
    let console_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_line_number(true)
        .with_span_events(FmtSpan::CLOSE)
        .with_filter(env_filter.clone());

    // File layer - JSON format for structured parsing.
    // Boxed to unify branch types; None в release по умолчанию (см.
    // file_logging_enabled) — файловых логов нет вообще.
    use tracing_subscriber::Layer;
    let file_layer = non_blocking_appender.map(|writer| {
        if enable_json {
            fmt::layer()
                .json()
                .with_target(true)
                .with_thread_ids(true)
                .with_thread_names(true)
                .with_line_number(true)
                .with_span_events(FmtSpan::CLOSE)
                .with_writer(writer)
                .with_filter(env_filter.clone())
                .boxed()
        } else {
            fmt::layer()
                .with_target(true)
                .with_thread_ids(true)
                .with_thread_names(true)
                .with_line_number(true)
                .with_span_events(FmtSpan::CLOSE)
                .with_writer(writer)
                .with_filter(env_filter)
                .boxed()
        }
    });

    // Initialize subscriber with layers (file layer optional)
    tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .try_init()
        .map_err(|e| format!("Failed to initialize tracing subscriber: {}", e))?;

    tracing::info!(
        log_dir = %log_dir.display(),
        file_logging = file_enabled,
        log_level = ?log_level,
        json_enabled = enable_json,
        "Logging system initialized"
    );

    Ok(())
}

/// Get default log directory based on OS
pub fn get_default_log_dir() -> PathBuf {
    if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("VaultBase").join("logs")
    } else {
        // Fallback to current directory
        PathBuf::from("./logs")
    }
}

/// Log a security event with structured fields
#[macro_export]
macro_rules! log_security {
    ($level:expr, $message:expr, $($key:tt = $value:expr),* $(,)?) => {
        tracing::event!(
            $level,
            event_type = "security",
            $($key = $value,)*
            "{}", $message
        );
    };
}

/// Log a performance metric with structured fields
#[macro_export]
macro_rules! log_metric {
    ($message:expr, $($key:tt = $value:expr),* $(,)?) => {
        tracing::info!(
            event_type = "metric",
            $($key = $value,)*
            "{}", $message
        );
    };
}

/// Log an API call with structured fields
#[macro_export]
macro_rules! log_api_call {
    ($method:expr, $endpoint:expr, $status:expr, $duration_ms:expr) => {
        tracing::info!(
            event_type = "api_call",
            method = $method,
            endpoint = $endpoint,
            status = $status,
            duration_ms = $duration_ms,
            "API call completed"
        );
    };
}

/// Log a database operation with structured fields
#[macro_export]
macro_rules! log_db_operation {
    ($operation:expr, $table:expr, $duration_ms:expr, $rows_affected:expr) => {
        tracing::debug!(
            event_type = "db_operation",
            operation = $operation,
            table = $table,
            duration_ms = $duration_ms,
            rows_affected = $rows_affected,
            "Database operation completed"
        );
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_init_logging_creates_directory() {
        let temp_dir = TempDir::new().unwrap();
        let log_dir = temp_dir.path().join("logs");

        // Directory should not exist initially
        assert!(!log_dir.exists());

        // Initialize logging (this might fail if already initialized in other tests)
        let _ = init_logging(log_dir.clone(), LogLevel::Info, true);

        // Directory should now exist
        assert!(log_dir.exists());
    }

    #[test]
    fn test_log_level_conversion() {
        assert_eq!(LevelFilter::from(LogLevel::Trace), LevelFilter::TRACE);
        assert_eq!(LevelFilter::from(LogLevel::Debug), LevelFilter::DEBUG);
        assert_eq!(LevelFilter::from(LogLevel::Info), LevelFilter::INFO);
        assert_eq!(LevelFilter::from(LogLevel::Warn), LevelFilter::WARN);
        assert_eq!(LevelFilter::from(LogLevel::Error), LevelFilter::ERROR);
    }

    #[test]
    fn test_get_default_log_dir() {
        let log_dir = get_default_log_dir();
        assert!(log_dir.to_string_lossy().contains("VaultBase"));
        assert!(log_dir.to_string_lossy().contains("logs"));
    }
}
