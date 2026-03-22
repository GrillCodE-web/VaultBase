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
}

module.exports = { getDb };
