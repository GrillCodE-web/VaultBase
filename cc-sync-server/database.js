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
  // Run versioned migrations
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
        -- Tauri updater fields
        download_url      TEXT,          -- full URL to .dmg / .tar.gz
        signature         TEXT,          -- Tauri ed25519 signature (content of .sig file)
        file_size         INTEGER,       -- bytes
        platform          TEXT DEFAULT 'darwin-aarch64',
        is_published      INTEGER DEFAULT 0  -- 0=draft, 1=live (served via /update)
      );

      INSERT OR IGNORE INTO versions (version, notes, is_published)
        VALUES ('1.0.0', 'Initial release', 1);

      PRAGMA user_version = 1;
    `);
  }

  if (ver < 2) {
    // Future migrations go here
    db.pragma('user_version = 2');
  }
}

module.exports = { getDb };
