// Server-side alert engine: worker-offline detection.
//
// Numeric alert rules (spiking decline rate, quota exhaustion, dead-card ratio)
// are evaluated by the manager app on decrypted telemetry — the server cannot
// read the payloads. Only timing-based signals (no heartbeat) are detectable
// here, because timestamps are the only plaintext part of a heartbeat.
const { getDb } = require('./database');

const OFFLINE_MINUTES = Math.max(1, parseInt(process.env.MANAGER_OFFLINE_MINUTES || '10', 10) || 10);

let timer = null;

function tick() {
  try {
    const db = getDb();
    const cutoff = `-${OFFLINE_MINUTES} minutes`;

    db.prepare(`
      UPDATE manager_alerts SET status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE category = 'worker_offline' AND status IN ('new','ack')
        AND installation_id IN (
          SELECT installation_id FROM worker_heartbeats
          WHERE last_seen >= datetime('now', ?)
        )
    `).run(cutoff);

    const stale = db.prepare(`
      SELECT l.installation_id, l.label, hb.last_seen
      FROM licenses l
      JOIN worker_heartbeats hb ON hb.installation_id = l.installation_id
      WHERE l.is_active = 1 AND l.role != 'manager'
        AND hb.last_seen < datetime('now', ?)
    `).all(cutoff);

    const upsert = db.prepare(`
      INSERT INTO manager_alerts (severity, category, installation_id, title, message, dedupe_key)
      VALUES ('warning', 'worker_offline', ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET message = excluded.message
    `);

    for (const w of stale) {
      const name = w.label ? `${w.label} (${w.installation_id.slice(0, 8)})` : w.installation_id.slice(0, 8);
      upsert.run(
        w.installation_id,
        `Worker offline: ${name}`,
        `No heartbeat since ${w.last_seen} (threshold: ${OFFLINE_MINUTES} min)`,
        `offline:${w.installation_id}:${w.last_seen}`
      );
    }
  } catch (e) {
    console.error('[alerts-engine] tick failed:', e.message);
  }
}

function start() {
  if (!timer) {
    tick();
    timer = setInterval(tick, 60_000);
    if (typeof timer.unref === 'function') timer.unref();
  }
}

function shutdown() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, shutdown, tick, OFFLINE_MINUTES };
