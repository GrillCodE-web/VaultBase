// MGR-013: локальное криптостирание (panic-пароль / удалённый wipe).
//
// Гарантия необратимости — потеря DEK: ключ шифрования БД существует только
// внутри sidecar-конверта (обёрнут ключом из мастер-пароля). Перезаписываем
// sidecar случайными байтами и удаляем его вместе с файлами БД — содержимое
// базы навсегда остаётся шифротекстом. Полнодисковая перезапись на SSD/NTFS
// не гарантирует физическое уничтожение и заняла бы часы — не делаем.
//
// Сознательно БЕЗ логов и audit-записей: срабатывание не должно оставлять
// локальных следов (снаружи это выглядит как «неверный пароль»).

use rand::RngCore;
use std::io::Write;

const OVERWRITE_CAP: u64 = 16 * 1024 * 1024; // первые 16 МБ каждого файла

fn overwrite_then_remove(path: &str) {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.is_file() {
            if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open(path) {
                let len = meta.len().min(OVERWRITE_CAP);
                let mut chunk = [0u8; 65536];
                rand::rngs::OsRng.fill_bytes(&mut chunk);
                let mut left = len;
                while left > 0 {
                    let n = left.min(chunk.len() as u64) as usize;
                    if f.write_all(&chunk[..n]).is_err() {
                        break;
                    }
                    left -= n as u64;
                }
                let _ = f.flush();
                let _ = f.sync_all();
            }
        }
    }
    // Файл может быть занят (антивирус/индексатор) — несколько попыток.
    for _ in 0..5 {
        if std::fs::remove_file(path).is_ok() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// Перезаписать и удалить все файлы в директории (нерекурсивно — наши
/// директории плоские), затем саму директорию.
fn wipe_dir(dir: &std::path::Path) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_file() {
                overwrite_then_remove(&p.to_string_lossy());
            }
        }
    }
    let _ = std::fs::remove_dir(dir);
}

/// Стереть БД и всё, что нужно для её расшифровки. Перед вызовом соединения
/// обязаны быть закрыты (`db.close_connections()`), иначе на Windows удаление
/// файла не удастся.
///
/// Заодно стираются форензик-следы приложения: автобэкапы (`backups/`) —
/// дополнительные копии БД с датами в именах — и файловые логи (`logs/`),
/// содержащие хронологию сессий и пути с именем пользователя ОС.
pub fn wipe_local_data(db_path: &str) {
    wipe_local_data_in(
        db_path,
        &[
            // Автобэкапы: копии БД (даже шифрованные — лишний шифротекст под
            // перебор).
            crate::state::backup_dir(),
            // Файловые логи: хронология сессий, пути с именем пользователя ОС.
            crate::logging::get_default_log_dir(),
        ],
    );
}

/// Ядро wipe: файлы базы + произвольный набор каталогов-следов. Вынесено, чтобы
/// тесты стирали только временные каталоги, а не реальные `backups/`/`logs/`.
fn wipe_local_data_in(db_path: &str, extra_dirs: &[std::path::PathBuf]) {
    let sidecar = crate::database::Database::salt_file_path(db_path);
    let files = [
        sidecar.clone(),
        format!("{}.bak", sidecar),
        db_path.to_string(),
        format!("{}-wal", db_path),
        format!("{}-shm", db_path),
        format!("{}.plaintext.bak", db_path),
    ];
    for f in files {
        overwrite_then_remove(&f);
    }
    for dir in extra_dirs {
        wipe_dir(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    #[test]
    fn wipe_removes_db_and_sidecar_files() {
        let dir = std::env::temp_dir().join(format!("vb_wipe_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("vaultbase.db");
        let dbp = db.to_str().unwrap();
        for suffix in ["", "-wal", "-shm", ".salt", ".salt.bak", ".plaintext.bak"] {
            let mut f = std::fs::File::create(format!("{}{}", dbp, suffix)).unwrap();
            f.write_all(b"secret-data").unwrap();
        }

        // Тестируем ядро с временным каталогом: публичный wipe_local_data стёр бы
        // реальные backups/logs на машине разработчика.
        let extra = vec![dir.join("backups"), dir.join("logs")];
        std::fs::create_dir_all(dir.join("backups")).unwrap();
        std::fs::write(dir.join("backups").join("backup_1.db"), b"copy").unwrap();
        wipe_local_data_in(dbp, &extra);

        for suffix in ["", "-wal", "-shm", ".salt", ".salt.bak", ".plaintext.bak"] {
            assert!(
                !std::path::Path::new(&format!("{}{}", dbp, suffix)).exists(),
                "file {}{} must be wiped",
                dbp,
                suffix
            );
        }
        assert!(
            !dir.join("backups").join("backup_1.db").exists(),
            "backup copy must be wiped"
        );
        assert!(!dir.join("logs").exists(), "logs dir must be wiped");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wipe_is_silent_when_nothing_exists() {
        let dbp = std::env::temp_dir()
            .join(format!("vb_wipe_none_{}", std::process::id()))
            .to_str()
            .unwrap()
            .to_string();
        wipe_local_data_in(&dbp, &[]); // не паникует
    }
}
