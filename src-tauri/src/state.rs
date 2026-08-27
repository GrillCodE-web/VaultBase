// ─────────────────────────────────────────
//  Global state & shared helpers
// ─────────────────────────────────────────

use crate::database::Database;
use crate::models::ActiveUser;
use crate::ws_sync::WsSyncHandle;
use crate::config::Config;  // SPRINT3-DAY4: Add config to state
use once_cell::sync::OnceCell;
use std::path::PathBuf;
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};

pub(crate) struct AppState {
    pub(crate) config: Config,  // SPRINT3-DAY4: Application configuration
    pub(crate) db: Mutex<Database>,
    pub(crate) is_locked: AtomicBool,
    pub(crate) current_user: Mutex<Option<ActiveUser>>,
    /// MGR-005: последняя известная политика воркера (с сервера телеметрии).
    pub(crate) policy: Mutex<PolicyState>,
}
pub(crate) static STATE: OnceCell<AppState> = OnceCell::new();

/// MGR-005: политика воркера, применяемая живьём. Хранится в памяти (быстрый
/// доступ из require_perm без блокировки БД) и персистится в config
/// `worker_policy`; восстанавливается при логине (restore_policy_from_config).
#[derive(Debug, Clone, Default)]
pub(crate) struct PolicyState {
    pub banned: bool,
    pub banned_reason: Option<String>,
    pub ban_until: Option<String>,
    pub update_required: bool,
    pub min_version: Option<String>,
    /// permissions_override: bool-карта поверх models::perms.
    /// Явный false режет право даже админу, явный true — выдаёт.
    pub permissions_override: Option<std::collections::HashMap<String, bool>>,
    pub quota_cards_day: Option<i64>,
    pub quota_orders_day: Option<i64>,
    pub force_logout: bool,
}

/// Снимок политики для команд/тиков; пустой, если STATE ещё не инициализирован.
pub(crate) fn policy_snapshot() -> PolicyState {
    STATE.get()
        .and_then(|st| st.policy.lock().ok().map(|p| p.clone()))
        .unwrap_or_default()
}

/// Чистая проверка права с учётом override — вся логика мержа здесь.
pub(crate) fn perm_allowed_with(policy: &PolicyState, u: &ActiveUser, key: &str) -> bool {
    if let Some(ov) = &policy.permissions_override {
        if let Some(v) = ov.get(key) {
            return *v;
        }
    }
    u.has_perm(key)
}

// FIX CRITICAL: Return Option instead of panicking
pub(crate) fn state() -> &'static AppState {
    STATE.get().unwrap_or_else(|| {
        eprintln!("❌ КРИТИЧЕСКАЯ ОШИБКА: AppState не инициализирован");
        eprintln!("   Это программная ошибка - состояние должно быть установлено в main()");
        eprintln!("\nПриложение будет закрыто.");
        std::process::exit(1);
    })
}

/// Получить текущего пользователя или вернуть ошибку.
/// MGR-005: бан воркера режет все авторизованные команды (как на сервере).
pub(crate) fn require_user() -> Result<ActiveUser, String> {
    let st = state();
    if st.policy.lock().map(|p| p.banned).unwrap_or(false) {
        return Err("banned".to_string());
    }
    st.current_user.lock().map_err(|e| e.to_string())?
        .clone().ok_or_else(|| "not_logged_in".to_string())
}

/// Проверить право у текущего пользователя (с учётом permissions_override)
pub(crate) fn require_perm(key: &str) -> Result<ActiveUser, String> {
    let u = require_user()?;
    if !perm_allowed_with(&policy_snapshot(), &u, key) {
        return Err(format!("permission_denied:{}", key));
    }
    Ok(u)
}

/// Проверить что текущий пользователь — admin
pub(crate) fn require_admin() -> Result<ActiveUser, String> {
    let u = require_user()?;
    if !u.is_admin() { return Err("permission_denied:admin_only".to_string()); }
    Ok(u)
}

/// Проверить хотя бы одно право из списка.
/// Нужно там, где одно и то же действие законно для двух разных ролей —
/// например создание магазина: и как управление справочником, и как побочный
/// шаг оформления заказа по магазину из каталога.
pub(crate) fn require_any_perm(keys: &[&str]) -> Result<ActiveUser, String> {
    let u = require_user()?;
    let policy = policy_snapshot();
    if keys.iter().any(|k| perm_allowed_with(&policy, &u, k)) { return Ok(u); }
    Err(format!("permission_denied:{}", keys.join("|")))
}

// ── WS Sync global handle ──────────────────────────────────────────────────
pub(crate) static WS_HANDLE: OnceCell<std::sync::Arc<WsSyncHandle>> = OnceCell::new();

// FIX CRITICAL: Return graceful error instead of panicking
pub(crate) fn ws_handle() -> &'static std::sync::Arc<WsSyncHandle> {
    WS_HANDLE.get().unwrap_or_else(|| {
        eprintln!("❌ КРИТИЧЕСКАЯ ОШИБКА: WsSyncHandle не инициализирован");
        eprintln!("   Это программная ошибка - handle должен быть установлен в main()");
        eprintln!("\nПриложение будет закрыто.");
        std::process::exit(1);
    })
}

// ─────────────────────────────────────────
//  ARCH-005: bounded thread-pool для on-demand фоновых задач
// ─────────────────────────────────────────
// Раньше каждая IMAP-команда (refresh folder, list folders, check_all)
// делала `std::thread::spawn` — при N аккаунтах или быстрых повторных
// вызовах это создавало неограниченное число потоков. Здесь — фиксированный
// пул из 2 воркеров с bounded-очередью на 64 задачи. При переполнении
// очереди задача молча отбрасывается (IMAP-операции идемпотентны и
// повторятся на следующем цикле поллинга).

type BoxedTask = Box<dyn FnOnce() + Send + 'static>;

struct TaskPool {
    sender: Mutex<std::sync::mpsc::SyncSender<BoxedTask>>,
}

static TASK_POOL: OnceCell<TaskPool> = OnceCell::new();

fn task_pool() -> &'static TaskPool {
    TASK_POOL.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::sync_channel::<BoxedTask>(64);
        let rx = std::sync::Arc::new(Mutex::new(rx));
        for _ in 0..2 {
            let rx = std::sync::Arc::clone(&rx);
            std::thread::spawn(move || loop {
                let task = {
                    let lock = rx.lock();
                    match lock {
                        Ok(guard) => guard.recv(),
                        Err(_) => return, // отравленный мьютекс — воркер завершается
                    }
                };
                match task {
                    Ok(job) => job(),
                    Err(_) => return, // канал закрыт — воркер завершается
                }
            });
        }
        TaskPool { sender: Mutex::new(tx) }
    })
}

/// Поставить фоновую задачу в очередь пула. Возвращает false, если очередь
/// переполнена (задача не будет выполнена — вызывающий может залогировать).
pub(crate) fn spawn_task<F>(f: F) -> bool
where
    F: FnOnce() + Send + 'static,
{
    let pool = task_pool();
    let Ok(sender) = pool.sender.lock() else { return false };
    match sender.try_send(Box::new(f)) {
        Ok(()) => true,
        Err(std::sync::mpsc::TrySendError::Full(_)) => {
            eprintln!("[task_pool] очередь переполнена (64), задача отброшена");
            false
        }
        Err(std::sync::mpsc::TrySendError::Disconnected(_)) => false,
    }
}

pub(crate) fn db_path() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let cwd = std::env::current_dir().unwrap_or_default();
        let mut p = if cwd.file_name().map(|n| n == "src-tauri").unwrap_or(false) {
            let mut parent = cwd.clone();
            parent.pop();
            parent
        } else {
            cwd
        };
        p.push("vaultbase.db");
        p
    }
    #[cfg(not(debug_assertions))]
    {
        let dir = dirs::data_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("vaultbase");
        std::fs::create_dir_all(&dir).ok();
        dir.join("vaultbase.db")
    }
}

/// Единая директория для всех бэкапов (FIX B29)
pub(crate) fn backup_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("vaultbase")
        .join("backups")
}

macro_rules! with_db {
    ($db:ident, $body:block) => {{
        let mut guard = crate::state::state().db.lock().map_err(|e| e.to_string())?;
        let $db = &mut *guard;
        $db.touch_activity();
        $body
    }};
}
pub(crate) use with_db;

// ─────────────────────────────────────────
//  Whitelist для get_config/set_config (FIX B49)
// ─────────────────────────────────────────

// Секреты сюда НЕ добавляются. API-ключ не должен передаваться во frontend
// даже зашифрованным: вместо значения читается виртуальный флаг `<key>_set`
// (см. CONFIG_SECRET и get_config). Тот же паттерн, что у license_token.
const CONFIG_READABLE: &[&str] = &[
    "autolock_timeout",
    "sync_enabled", "theme", "language", "installation_id",
    "license_status_cache",
    "sync_group_id", "sync_group_name",
    "always_on_top", "last_backup_time",
    "dash_collapsed_banks", "dash_collapsed_countries",
    "dash_collapsed_sources", "dash_collapsed_expiring",
    "badge_notify_imap", "badge_notify_tracking",
    "stuffer_base_url",
    "stuffer_provider",
];

/// Ключи-секреты: записать можно, прочитать значение — нельзя.
/// Frontend вместо значения запрашивает `<key>_set` и получает "1" либо "0".
const CONFIG_SECRET: &[&str] = &[
    "bin_api_key", "tracking_api_key", "stuffer_api_key",
];

const CONFIG_WRITABLE: &[&str] = &[
    "autolock_timeout", "bin_api_key", "tracking_api_key",
    "sync_enabled", "theme", "language",
    "always_on_top", "last_backup_time",
    "dash_collapsed_banks", "dash_collapsed_countries",
    "dash_collapsed_sources", "dash_collapsed_expiring",
    "badge_notify_imap", "badge_notify_tracking",
    "stuffer_provider",
];

pub(crate) fn is_config_readable(key: &str) -> bool {
    CONFIG_READABLE.contains(&key)
}
pub(crate) fn is_config_writable(key: &str) -> bool {
    CONFIG_WRITABLE.contains(&key)
}
/// Для `"bin_api_key_set"` вернёт `Some("bin_api_key")`.
pub(crate) fn secret_flag_target(key: &str) -> Option<&'static str> {
    let base = key.strip_suffix("_set")?;
    CONFIG_SECRET.iter().copied().find(|k| *k == base)
}

pub(crate) fn auto_backup(db: &Database) -> Result<(), String> {
    let src = match db.conn.path() {
        Some(p) => p.to_string(),
        None => return Ok(()),
    };
    // FIX B29: единая директория через backup_dir()
    let bdir = backup_dir();
    std::fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let dest = bdir.join(format!("backup_{ts}.db"));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    // FIX B09: фильтруем только файлы backup_*.db
    let mut entries: Vec<_> = std::fs::read_dir(&bdir)
        .map(|rd| rd.filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("backup_"))
            .collect())
        .unwrap_or_default();
    entries.sort_by_key(|e| e.file_name());
    if entries.len() > 30 {
        for old in &entries[..entries.len() - 30] {
            let _ = std::fs::remove_file(old.path());
        }
    }
    let _ = db.log_event("system.backup_created", &format!("Auto-backup: {}", dest.display()), Some("system"), None);
    Ok(())
}

/// Internal helper for getting config from tracking module
pub(crate) fn get_config_internal(key: &str) -> Result<Option<String>, String> {
    with_db!(db, {
        db.get_config(key).map_err(|e| e.to_string())
    })
}


#[cfg(test)]
mod tests {
    use super::*;

    /// SEC-021: секретные ключи никогда не должны оказаться в READABLE —
    /// иначе frontend смог бы прочитать raw-значение через get_config.
    #[test]
    fn secrets_are_never_readable() {
        for secret in CONFIG_SECRET {
            assert!(
                !CONFIG_READABLE.contains(secret),
                "secret key {secret} must not be readable"
            );
            // ...но флаг наличия `<key>_set` должен резолвиться
            let flag = format!("{secret}_set");
            assert_eq!(secret_flag_target(&flag), Some(*secret));
        }
    }

    #[test]
    fn non_secret_set_flag_is_not_special() {
        assert_eq!(secret_flag_target("theme_set"), None);
        assert_eq!(secret_flag_target("autolock_timeout_set"), None);
    }

    /// Секреты, для которых нет отдельной команды записи (у stuffer_api_key
    /// она своя — commands/stuffer.rs), должны быть writable через set_config.
    #[test]
    fn secrets_without_dedicated_setter_are_writable() {
        for secret in ["bin_api_key", "tracking_api_key"] {
            assert!(CONFIG_WRITABLE.contains(&secret));
        }
    }
}
