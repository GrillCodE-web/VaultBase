const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  const ver = db.pragma('user_version', { simple: true });

  if (ver < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS licenses (
        installation_id TEXT PRIMARY KEY,
        challenge       TEXT NOT NULL,
        token           TEXT UNIQUE,
        label           TEXT DEFAULT '',
        is_active       INTEGER DEFAULT 1,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen       DATETIME
      );

      CREATE TABLE IF NOT EXISTS footprints (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_domain TEXT NOT NULL,
        hash_type   TEXT NOT NULL,
        hash_value  TEXT NOT NULL,
        user_token  TEXT NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shop_domain, hash_type, hash_value, user_token)
      );

      CREATE INDEX IF NOT EXISTS idx_footprints_lookup
        ON footprints(shop_domain, hash_type, hash_value);
      CREATE INDEX IF NOT EXISTS idx_footprints_token
        ON footprints(user_token);

      CREATE TABLE IF NOT EXISTS versions (
        version      TEXT PRIMARY KEY,
        notes        TEXT DEFAULT '',
        published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        download_url      TEXT,
        signature         TEXT,
        file_size         INTEGER,
        platform          TEXT DEFAULT 'darwin-aarch64',
        is_published      INTEGER DEFAULT 0
      );

      INSERT OR IGNORE INTO versions (version, notes, is_published)
        VALUES ('1.0.0', 'Initial release', 1);

      PRAGMA user_version = 1;
    `);
  }

  if (ver < 2) {
    db.pragma('user_version = 2');
  }

  if (ver < 3) {
    // Add invite_codes table
    db.exec(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        code        TEXT PRIMARY KEY,
        label       TEXT DEFAULT '',
        is_used     INTEGER DEFAULT 0,
        used_at     DATETIME,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at  DATETIME
      );

      PRAGMA user_version = 3;
    `);
  }

  if (ver < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS release_files (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        version      TEXT NOT NULL,
        file_type    TEXT NOT NULL DEFAULT 'updater',
        platform     TEXT DEFAULT 'darwin-aarch64',
        download_url TEXT,
        signature    TEXT,
        file_size    INTEGER,
        notes        TEXT DEFAULT '',
        is_published INTEGER DEFAULT 0,
        published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(version, file_type)
      );

      INSERT OR IGNORE INTO release_files
        (version, file_type, platform, download_url, signature, file_size, notes, is_published, published_at)
        SELECT version, 'updater', platform, download_url, signature, file_size, notes, is_published, published_at
        FROM versions WHERE download_url IS NOT NULL;

      PRAGMA user_version = 4;
    `);
  }

  if (ver < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_groups (
        id         TEXT PRIMARY KEY,
        name       TEXT DEFAULT 'Sync Group',
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_group_members (
        group_id            TEXT NOT NULL,
        installation_id     TEXT NOT NULL,
        group_key_encrypted TEXT,
        joined_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, installation_id)
      );

      CREATE TABLE IF NOT EXISTS sync_cards (
        card_hash      TEXT NOT NULL,
        group_id       TEXT NOT NULL,
        encrypted_data TEXT,
        status         TEXT NOT NULL DEFAULT 'free',
        notes          TEXT,
        updated_by     TEXT,
        updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (card_hash, group_id)
      );

      CREATE INDEX IF NOT EXISTS idx_sync_cards_group ON sync_cards(group_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_sync_members_iid ON sync_group_members(installation_id);

      PRAGMA user_version = 5;
    `);
  }

  // FIX A-MED-06: Add auto_rotate column for token rotation policy
  if (ver < 6) {
    db.exec(`
      ALTER TABLE licenses ADD COLUMN auto_rotate INTEGER DEFAULT 0;
      ALTER TABLE licenses ADD COLUMN token_rotated_at DATETIME;
      PRAGMA user_version = 6;
    `);
  }

  // FIX A-MED-06: Add audit_log table for token rotation tracking
  if (ver < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        action      TEXT NOT NULL,
        details     TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
      PRAGMA user_version = 7;
    `);
  }

  // Multi-use invite codes: add max_uses and use_count columns
  if (ver < 8) {
    db.exec(`
      ALTER TABLE invite_codes ADD COLUMN max_uses  INTEGER DEFAULT 1;
      ALTER TABLE invite_codes ADD COLUMN use_count INTEGER DEFAULT 0;
      UPDATE invite_codes SET use_count = is_used;
      PRAGMA user_version = 8;
    `);
  }

  // License-based roles: each license carries the role (admin/operator)
  // that the desktop app applies locally after activation/verify.
  if (ver < 9) {
    db.exec(`
      ALTER TABLE licenses ADD COLUMN role TEXT NOT NULL DEFAULT 'operator';
      UPDATE licenses SET role = 'admin';
      PRAGMA user_version = 9;
    `);
  }

  // SEC-008 (исторически): zero-knowledge pair codes. MGR-016 закрыл выдачу
  // и вход по pair-кодам (410 Gone), MGR-018 (этап E1) добивает остаток:
  // sync_pair_codes дропается миграцией v24 — ALTER'ы здесь больше не нужны,
  // оставлен только шаг версии, чтобы не сдвигать нумерацию существующих БД.
  if (ver < 10) {
    db.exec(`PRAGMA user_version = 10;`);
  }

  // VaultBase Manager: telemetry pipeline, worker policies, news, shop
  // priorities and alerts. Payloads arrive as sealed envelopes — the server
  // stores ciphertext only (see docs/MANAGER_APP.md for the crypto contract).
  if (ver < 11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS manager_keys (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id  TEXT NOT NULL,
        pubkey           TEXT NOT NULL,
        key_type         TEXT NOT NULL DEFAULT 'x25519',
        label            TEXT DEFAULT '',
        is_active        INTEGER NOT NULL DEFAULT 1,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at       DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_manager_keys_active ON manager_keys(is_active, id);

      CREATE TABLE IF NOT EXISTS manager_news (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
        title         TEXT NOT NULL,
        body          TEXT NOT NULL DEFAULT '',
        target_role   TEXT NOT NULL DEFAULT 'all',
        target_iid    TEXT,
        created_by    TEXT,
        is_published  INTEGER NOT NULL DEFAULT 0,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        published_at  DATETIME,
        expires_at    DATETIME
      );

      CREATE TABLE IF NOT EXISTS news_reads (
        news_id          INTEGER NOT NULL,
        installation_id  TEXT NOT NULL,
        read_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (news_id, installation_id)
      );

      CREATE TABLE IF NOT EXISTS worker_policies (
        installation_id      TEXT PRIMARY KEY,
        banned               INTEGER NOT NULL DEFAULT 0,
        banned_reason        TEXT,
        ban_until            DATETIME,
        permissions_override TEXT,
        quota_cards_day      INTEGER,
        quota_orders_day     INTEGER,
        min_version          TEXT,
        version_exempt       INTEGER NOT NULL DEFAULT 0,
        force_logout         INTEGER NOT NULL DEFAULT 0,
        updated_by           TEXT,
        updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS worker_heartbeats (
        installation_id  TEXT PRIMARY KEY,
        last_seen        DATETIME NOT NULL,
        key_id           INTEGER,
        envelope         TEXT,
        received_at      DATETIME
      );

      CREATE TABLE IF NOT EXISTS worker_heartbeat_history (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id  TEXT NOT NULL,
        ts               DATETIME NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hb_history ON worker_heartbeat_history(installation_id, ts);

      CREATE TABLE IF NOT EXISTS stats_reports (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id  TEXT NOT NULL,
        kind             TEXT NOT NULL,
        report_date      TEXT NOT NULL,
        key_id           INTEGER,
        envelopes        TEXT NOT NULL,
        received_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(installation_id, kind, report_date)
      );

      CREATE TABLE IF NOT EXISTS shop_priorities (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_domain  TEXT NOT NULL,
        target       TEXT NOT NULL DEFAULT '',
        weight       INTEGER NOT NULL DEFAULT 5,
        notes        TEXT DEFAULT '',
        updated_by   TEXT,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shop_domain, target)
      );

      CREATE TABLE IF NOT EXISTS manager_alerts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
        category        TEXT NOT NULL,
        installation_id TEXT,
        title           TEXT NOT NULL,
        message         TEXT DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','ack','closed')),
        dedupe_key      TEXT UNIQUE,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        acked_by        TEXT,
        acked_at        DATETIME,
        closed_at       DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_manager_alerts_status ON manager_alerts(status, created_at);

      PRAGMA user_version = 11;
    `);
  }

  // FEAT-010: sync тегов курьеров ("использован под zoro.com"). Теги ключуются
  // SHA-256 хешем личности курьера — сервер не видит ни имён, ни адресов.
  // Хранится только последнее действие (add/remove), история не ведётся.
  if (ver < 12) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_courier_tags (
        group_id     TEXT NOT NULL,
        provider     TEXT NOT NULL DEFAULT 'swat',
        courier_hash TEXT NOT NULL,
        tag          TEXT NOT NULL,
        action       TEXT NOT NULL DEFAULT 'add' CHECK (action IN ('add','remove')),
        updated_by   TEXT,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, provider, courier_hash, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_sync_courier_tags_group ON sync_courier_tags(group_id, updated_at);

      PRAGMA user_version = 12;
    `);
  }

  // MGR-008: токены лицензий и user_token в footprints больше не хранятся в
  // открытом виде — только SHA-256 хеш (токены 64-hex, энтропии достаточно,
  // bcrypt не нужен). Бэкфилл в JS, т.к. у SQLite нет встроенного sha256.
  // Здесь же — server_config: флаги kill_switch и ws_require_nonce.
  if (ver < 13) {
    db.exec(`
      ALTER TABLE licenses ADD COLUMN token_hash TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_token_hash
        ON licenses(token_hash) WHERE token_hash IS NOT NULL;

      CREATE TABLE IF NOT EXISTS server_config (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const licRows = db.prepare('SELECT installation_id, token FROM licenses WHERE token IS NOT NULL').all();
    const updLic = db.prepare('UPDATE licenses SET token_hash = ?, token = NULL WHERE installation_id = ?');
    for (const r of licRows) updLic.run(hashToken(r.token), r.installation_id);

    const fpRows = db.prepare('SELECT DISTINCT user_token FROM footprints').all();
    const updFp = db.prepare('UPDATE footprints SET user_token = ? WHERE user_token = ?');
    for (const r of fpRows) updFp.run(hashToken(r.user_token), r.user_token);

    db.pragma('user_version = 13');
  }

  // MGR-009: staged rollout релизов manager-app. channel: stable|beta
  // (beta-клиент видит оба канала, stable — только stable); rollout_percent —
  // детерминированный процент флота по хешу installation_id+version.
  if (ver < 14) {
    db.exec(`
      ALTER TABLE release_files ADD COLUMN channel TEXT NOT NULL DEFAULT 'stable';
      ALTER TABLE release_files ADD COLUMN rollout_percent INTEGER NOT NULL DEFAULT 100;
    `);
    db.pragma('user_version = 14');
  }

  // MGR-013: удалённый wipe воркера — менеджер ставит флаг, воркер получает
  // его в политике на heartbeat, стирает локальную БД и подтверждает
  // (wipe_ack) — сервер сбрасывает флаг.
  if (ver < 15) {
    db.exec(`ALTER TABLE worker_policies ADD COLUMN wipe INTEGER NOT NULL DEFAULT 0;`);
    db.pragma('user_version = 15');
  }

  // MGR-016: архитектура «воркер = потребитель». Карты создаёт ТОЛЬКО
  // менеджер и раздаёт воркерам запечатанными срезами (X25519-пубключ
  // воркера — зеркало manager_keys). Легаси-группы/pair-коды гасятся:
  // существующие члены продолжают синкаться, новые группы создать нельзя.
  // issued_card_slices — очередь доставки: сервер хранит только шифротекст.
  if (ver < 16) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_keys (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id  TEXT NOT NULL,
        pubkey           TEXT NOT NULL,
        key_type         TEXT NOT NULL DEFAULT 'x25519',
        label            TEXT DEFAULT '',
        is_active        INTEGER NOT NULL DEFAULT 1,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at       DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_worker_keys_active ON worker_keys(is_active, id);

      ALTER TABLE sync_cards ADD COLUMN issued_by TEXT NOT NULL DEFAULT 'worker';
      ALTER TABLE sync_groups ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS issued_card_slices (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        card_hash    TEXT NOT NULL,
        target_iid   TEXT NOT NULL,
        sealed_data  TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','ack','revoked')),
        issued_by    TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        delivered_at DATETIME,
        acked_at     DATETIME,
        UNIQUE(card_hash, target_iid)
      );
      CREATE INDEX IF NOT EXISTS idx_issued_slices_target ON issued_card_slices(target_iid, status);

      PRAGMA user_version = 16;
    `);
  }

  // DEVOPS-006: release_files имела UNIQUE(version, file_type) — БЕЗ платформы.
  // Заливка одного релиза под 3 ОС перезаписывала одну и ту же строку, и в
  // /update выживал последний залитый артефакт (по факту Linux): Windows- и
  // macOS-клиенты обновлений не видели. Пересоздаём таблицу с
  // UNIQUE(version, file_type, platform). Старые строки переносим как есть —
  // дубликатов (version,file_type,platform) в них быть не может, т.к. старый
  // ключ был строже.
  if (ver < 17) {
    db.exec(`
      CREATE TABLE release_files_v17 (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        version         TEXT NOT NULL,
        file_type       TEXT NOT NULL DEFAULT 'updater',
        platform        TEXT DEFAULT 'darwin-aarch64',
        download_url    TEXT,
        signature       TEXT,
        file_size       INTEGER,
        notes           TEXT DEFAULT '',
        is_published    INTEGER DEFAULT 0,
        published_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        channel         TEXT NOT NULL DEFAULT 'stable',
        rollout_percent INTEGER NOT NULL DEFAULT 100,
        UNIQUE(version, file_type, platform)
      );
      INSERT OR IGNORE INTO release_files_v17
        (version, file_type, platform, download_url, signature, file_size, notes,
         is_published, published_at, channel, rollout_percent)
        SELECT version, file_type, platform, download_url, signature, file_size, notes,
               is_published, published_at, channel, rollout_percent
        FROM release_files;
      DROP TABLE release_files;
      ALTER TABLE release_files_v17 RENAME TO release_files;

      PRAGMA user_version = 17;
    `);
  }

  // MGR-019: расширенные политики воркера. can_add_cards — жёсткий запрет
  // создания карт (дублирует allowCreate:false на sync-слое, но видим
  // менеджеру и воркеру как политика). paused — воркеру не выдаются срезы,
  // закреплённое остаётся. decline_cooldown_minutes — окно тишины после
  // деклайна. max_profiles/max_drops — лимиты сущностей. shop_blacklist —
  // JSON-массив доменов шопов, выключенных для воркера.
  if (ver < 18) {
    db.exec(`
      ALTER TABLE worker_policies ADD COLUMN can_add_cards INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE worker_policies ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE worker_policies ADD COLUMN decline_cooldown_minutes INTEGER;
      ALTER TABLE worker_policies ADD COLUMN max_profiles INTEGER;
      ALTER TABLE worker_policies ADD COLUMN max_drops INTEGER;
      ALTER TABLE worker_policies ADD COLUMN shop_blacklist TEXT;
      PRAGMA user_version = 18;
    `);
  }

  // MGR-019: жизненный цикл worker_keys. Причина отзыва среза — бан воркера
  // отзывает с 'worker_banned', снятие бана перевыпускает ТОЛЬКО их;
  // ручные revoke менеджера (reason IS NULL) не затрагиваются.
  if (ver < 19) {
    db.exec(`
      ALTER TABLE issued_card_slices ADD COLUMN revoked_at DATETIME;
      ALTER TABLE issued_card_slices ADD COLUMN revoked_reason TEXT;
      PRAGMA user_version = 19;
    `);
  }

  // REDESIGN-05-5B1: пул карт с самообслуживанием. Менеджер заливает срезы,
  // зашифрованные симметричным ключом пула (AES-256-GCM, менеджерская
  // сторона), а сам ключ раздаёт воркерам запечатанным их X25519-пубключами
  // (card_pool_key_shares). Воркер сам бронирует срезы из пула
  // (pooled → reserved → ack); бронь без ack сгорает по TTL и возвращается
  // в пул (см. sweepExpiredReservations в routes/card-pool.js). Сервер по-
  // прежнему хранит только шифротекст.
  if (ver < 20) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS card_pool_keys (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        label       TEXT DEFAULT '',
        created_by  TEXT,
        is_active   INTEGER NOT NULL DEFAULT 1,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        rotated_at  DATETIME
      );

      CREATE TABLE IF NOT EXISTS card_pool_key_shares (
        key_id          INTEGER NOT NULL REFERENCES card_pool_keys(id),
        installation_id TEXT NOT NULL,
        sealed_key      TEXT NOT NULL,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (key_id, installation_id)
      );

      CREATE TABLE IF NOT EXISTS card_pool_slices (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        card_hash    TEXT NOT NULL UNIQUE,
        key_id       INTEGER NOT NULL REFERENCES card_pool_keys(id),
        sealed_data  TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pooled'
                     CHECK (status IN ('pooled','reserved','ack','revoked')),
        reserved_by  TEXT,
        reserved_at  DATETIME,
        acked_at     DATETIME,
        outcome      TEXT CHECK (outcome IS NULL OR outcome IN ('used','burned')),
        outcome_at   DATETIME,
        uploaded_by  TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_pool_slices_status ON card_pool_slices(status, reserved_by);

      PRAGMA user_version = 20;
    `);
  }

  // MGR-018 (этапы C/D): централизованные срезы прокси/email и share-ключи
  // конфигурации (stuffer base_url + API key). Та же модель, что у карт
  // (issued_card_slices): сервер — курьер шифротекста, менеджер запечатывает
  // X25519-пубключом воркера, воркер ack-ает после импорта.
  // asset_hash — непрозрачный дедуп-ключ от менеджера (email: хеш адреса,
  // proxy: хеш host:port:user); сервер содержимое не видит.
  // worker_config_shares — один актуальный конверт на (kind, target_iid):
  // повторная выдача перезаписывает и возвращает в pending.
  if (ver < 21) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS issued_asset_slices (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        kind         TEXT NOT NULL CHECK (kind IN ('proxy','email')),
        asset_hash   TEXT NOT NULL,
        target_iid   TEXT NOT NULL,
        sealed_data  TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','ack','revoked')),
        issued_by    TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        delivered_at DATETIME,
        acked_at     DATETIME,
        revoked_at   DATETIME,
        UNIQUE(kind, asset_hash, target_iid)
      );
      CREATE INDEX IF NOT EXISTS idx_asset_slices_target ON issued_asset_slices(target_iid, kind, status);

      CREATE TABLE IF NOT EXISTS worker_config_shares (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        kind         TEXT NOT NULL CHECK (kind IN ('stuffer')),
        target_iid   TEXT NOT NULL,
        sealed_data  TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','ack','revoked')),
        issued_by    TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        delivered_at DATETIME,
        acked_at     DATETIME,
        revoked_at   DATETIME,
        UNIQUE(kind, target_iid)
      );

      PRAGMA user_version = 21;
    `);
  }

  // REDESIGN-05-5B2: панель воркеров. Самопубликация оперативной статистики
  // воркером для своей sync-группы (заказы/деклайны/карты — агрегаты без
  // чувствительных данных). Presence берётся из WS-подключений, last_seen —
  // из worker_heartbeats, счётчики карт — из issued_card_slices/card_pool_slices;
  // эта таблица — только добровольные агрегаты, которые сервер иначе не видит
  // (E2E-контент заказов ему недоступен). Номер 22: v21 занята срезами
  // прокси/email (MGR-018 C/D) параллельной сессии.
  if (ver < 22) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_group_stats (
        installation_id TEXT PRIMARY KEY,
        group_id        TEXT NOT NULL,
        stats_json      TEXT NOT NULL,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_group_stats_group ON worker_group_stats(group_id);

      PRAGMA user_version = 22;
    `);
  }

  // MGR-018 (этап E2): share-ключи 17track от менеджера. CHECK kind
  // расширяется ('stuffer' → + 'track17'); SQLite не умеет ALTER CHECK —
  // пересборка таблицы с копированием строк.
  if (ver < 23) {
    db.exec(`
      CREATE TABLE worker_config_shares_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        kind         TEXT NOT NULL CHECK (kind IN ('stuffer','track17')),
        target_iid   TEXT NOT NULL,
        sealed_data  TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','ack','revoked')),
        issued_by    TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        delivered_at DATETIME,
        acked_at     DATETIME,
        revoked_at   DATETIME,
        UNIQUE(kind, target_iid)
      );
      INSERT INTO worker_config_shares_new
        (id, kind, target_iid, sealed_data, status, issued_by, created_at, delivered_at, acked_at, revoked_at)
        SELECT id, kind, target_iid, sealed_data, status, issued_by, created_at, delivered_at, acked_at, revoked_at
        FROM worker_config_shares;
      DROP TABLE worker_config_shares;
      ALTER TABLE worker_config_shares_new RENAME TO worker_config_shares;

      PRAGMA user_version = 23;
    `);
  }

  // MGR-018 (этап E1): pair-коды выпилены — endpoints отвечают 410 Gone ещё с
  // MGR-016, таблица мертва (ничто её не читает и не пишет). Сами группы
  // (sync_groups/sync_group_members) остаются: на них завязаны панель
  // воркеров (REDESIGN-05-5B2) и admin CRUD.
  if (ver < 24) {
    db.exec(`
      DROP TABLE IF EXISTS sync_pair_codes;
      PRAGMA user_version = 24;
    `);
  }

  // REDESIGN-05-5B4: E2E-чат (docs/CHAT_E2E.md). Сервер — тупой ретранслятор:
  // хранит ТОЛЬКО запечатанные конверты (тот же формат, что telemetry/
  // config-shares: {key_id, ephemeral, nonce, ct}) и метаданные маршрутизации
  // (кто кому, когда, размер). Одна строка = один конверт одному получателю
  // (fan-out на отправителе). plaintext на сервере не существует в принципе.
  // expires_at — мягкий TTL комнаты: сервер чистит блобы по истечении,
  // не читая их (лениво на send/fetch).
  if (ver < 25) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        room         TEXT NOT NULL,
        sender_iid   TEXT NOT NULL,
        target_iid   TEXT NOT NULL,
        sealed_data  TEXT NOT NULL,
        ref_type     TEXT,
        ref_id       TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at   DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_target ON chat_messages(target_iid, id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_expiry ON chat_messages(expires_at);

      PRAGMA user_version = 25;
    `);
  }

  // CHAT-2.0 (specs/chat-2.0.md, manager-work-0bp): delivered-квитанции.
  // Сервер помечает момент, когда получатель ЗАБРАЛ блоб fetch'ем, — это и есть
  // «доставлено на устройство» для отправителя (опрос /sync/chat/outbox).
  // Read-квитанции сервером не трогают: едут обратно отправителю обычными
  // sealed-конвертами (payload type 'read_receipt') — opaque-relay сохраняется.
  if (ver < 26) {
    db.exec(`
      ALTER TABLE chat_messages ADD COLUMN delivered_at DATETIME;
      CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_iid, id);

      PRAGMA user_version = 26;
    `);
  }
}

// SHA-256 от лицензионного токена. Токены — 32 случайных байта в hex, поэтому
// одного быстрого хеша достаточно (brute-force по 2^256 неактуален).
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function getServerConfig(key, defaultValue = null) {
  try {
    const row = getDb().prepare('SELECT value FROM server_config WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setServerConfig(key, value) {
  getDb().prepare(`
    INSERT INTO server_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, String(value));
}

// Kill-switch деплоя: при '1' воркерские каналы (sync/footprint/WS) и
// раздача обновлений отвечают 503. Менеджерские каналы и админка не глушатся,
// иначе выключатель нельзя будет вернуть обратно.
function isKillSwitchOn() {
  return getServerConfig('kill_switch', '0') === '1';
}

// Анти-replay WS: при '1' (или env WS_REQUIRE_NONCE=1) auth-сообщение обязано
// эхом возвращать одноразовый nonce из auth_challenge. По умолчанию выкл —
// старые клиенты продолжают работать, включается после обновления флота.
function isWsNonceRequired() {
  return process.env.WS_REQUIRE_NONCE === '1' || getServerConfig('ws_require_nonce', '0') === '1';
}

/**
 * Close the SQLite handle. Called during graceful shutdown so WAL content is
 * checkpointed into the main database file before the process exits.
 */
function closeDb() {
  if (!db) return;
  try {
    db.close();
  } catch (e) {
    console.error('[database] error closing SQLite handle:', e.message);
  } finally {
    db = null;
  }
}

module.exports = { getDb, closeDb, hashToken, getServerConfig, setServerConfig, isKillSwitchOn, isWsNonceRequired };
