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

/// Стереть БД и всё, что нужно для её расшифровки. Перед вызовом соединения
/// обязаны быть закрыты (`db.close_connections()`), иначе на Windows удаление
/// файла не удастся.
pub fn wipe_local_data(db_path: &str) {
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

        wipe_local_data(dbp);

        for suffix in ["", "-wal", "-shm", ".salt", ".salt.bak", ".plaintext.bak"] {
            assert!(
                !std::path::Path::new(&format!("{}{}", dbp, suffix)).exists(),
                "file {}{} must be wiped",
                dbp,
                suffix
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wipe_is_silent_when_nothing_exists() {
        let dbp = std::env::temp_dir()
            .join(format!("vb_wipe_none_{}", std::process::id()))
            .to_str()
            .unwrap()
            .to_string();
        wipe_local_data(&dbp); // не паникует
    }
}
