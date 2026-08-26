const Database = require('better-sqlite3');
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

      CREATE TABLE IF NOT EXISTS sync_pair_codes (
        code       TEXT PRIMARY KEY,
        group_id   TEXT NOT NULL,
        created_by TEXT,
        expires_at DATETIME,
        used_by    TEXT
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

  // SEC-008: zero-knowledge pair codes. The desktop client now generates the
  // pair code locally and sends only its SHA-256 hash plus the group key
  // encrypted with a key derived from the pair code. A server DB dump can no
  // longer reveal active pair codes or the group key plaintext.
  if (ver < 10) {
    db.exec(`
      ALTER TABLE sync_pair_codes ADD COLUMN code_hash      TEXT;
      ALTER TABLE sync_pair_codes ADD COLUMN enc_group_key  TEXT;
      CREATE INDEX IF NOT EXISTS idx_sync_pair_hash ON sync_pair_codes(code_hash);
      PRAGMA user_version = 10;
    `);
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

module.exports = { getDb, closeDb };
