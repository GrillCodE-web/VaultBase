//! Raw WebSocket handler for Tauri desktop clients.
//! Protocol:
//!   Client → Server: {"type":"auth","token":"<license_token>"}
//!   Server → Client: {"type":"auth_ok","installation_id":"...","group_id":"..."}  |  {"type":"auth_error","error":"..."}
//!   Client → Server: {"type":"full_pull"}
//!   Server → Client: {"type":"full_data","cards":[...]}
//!   Client → Server: {"type":"push","cards":[{card_hash,status,notes?,encrypted_data?}]}
//!   Server → Client: {"type":"card_update","cards":[...],"updated_by":"..."}  (broadcast to group)
//!   Server → Client: {"type":"member_joined","installation_id":"..."}
//!   Server → Client: {"type":"member_left","installation_id":"..."}
//!   Client → Server: {"type":"ping"}
//!   Server → Client: {"type":"pong"}

const { getDb } = require('./database');

// Map: installation_id → WebSocket
const clients = new Map();

const STATUS_WEIGHT = { dead: 5, declined: 4, archive: 3, in_use: 2, free: 1 };
function weight(s) { return STATUS_WEIGHT[s] || 0; }

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

module.exports = function initWsTauri(wss, io) {
  wss.on('connection', (ws) => {
    ws.authenticated = false;
    ws.installationId = null;
    ws.groupId = null;

    // Auth timeout — 10 seconds
    const authTimeout = setTimeout(() => {
      if (!ws.authenticated) ws.close(4001, 'auth_timeout');
    }, 10_000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }

      // ── Auth ──────────────────────────────────────────────────
      if (msg.type === 'auth') {
        clearTimeout(authTimeout);
        const token = msg.token?.trim();
        if (!token) { send(ws, { type: 'auth_error', error: 'missing_token' }); ws.close(); return; }

        const db = getDb();
        const row = db.prepare(
          'SELECT installation_id, is_active FROM licenses WHERE token = ?'
        ).get(token);

        if (!row || !row.is_active) {
          send(ws, { type: 'auth_error', error: 'invalid_token' });
          ws.close();
          return;
        }

        db.prepare('UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token = ?').run(token);

        const member = db.prepare(`
          SELECT sgm.group_id FROM sync_group_members sgm
          WHERE sgm.installation_id = ?
        `).get(row.installation_id);

        ws.authenticated = true;
        ws.installationId = row.installation_id;
        ws.userToken = token;
        ws.groupId = member?.group_id || null;

        clients.set(row.installation_id, ws);

        send(ws, {
          type: 'auth_ok',
          installation_id: row.installation_id,
          group_id: ws.groupId,
        });

        // Notify group members
        if (ws.groupId) {
          broadcastToGroup(ws.groupId, { type: 'member_joined', installation_id: ws.installationId }, ws.installationId);
        }
        return;
      }

      if (!ws.authenticated) return;

      // ── Ping ──────────────────────────────────────────────────
      if (msg.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }

      // ── Full pull ─────────────────────────────────────────────
      if (msg.type === 'full_pull') {
        if (!ws.groupId) { send(ws, { type: 'error', error: 'not_in_group' }); return; }
        const db = getDb();
        const cards = db.prepare(
          'SELECT card_hash, encrypted_data, status, notes, updated_by, updated_at FROM sync_cards WHERE group_id = ? ORDER BY updated_at DESC'
        ).all(ws.groupId);
        send(ws, { type: 'full_data', cards });
        return;
      }

      // ── Push card updates ──────────────────────────────────────
      if (msg.type === 'push') {
        if (!ws.groupId) { send(ws, { type: 'error', error: 'not_in_group' }); return; }
        const { cards } = msg;
        if (!Array.isArray(cards)) return;

        const db = getDb();
        const stmt = db.prepare(`
          INSERT INTO sync_cards (card_hash, group_id, encrypted_data, status, notes, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(card_hash, group_id) DO UPDATE SET
            status         = CASE WHEN ? > ? THEN excluded.status ELSE sync_cards.status END,
            encrypted_data = CASE WHEN ? > ? THEN excluded.encrypted_data ELSE sync_cards.encrypted_data END,
            notes          = CASE WHEN ? > ? THEN excluded.notes ELSE sync_cards.notes END,
            updated_by     = CASE WHEN ? > ? THEN excluded.updated_by ELSE sync_cards.updated_by END,
            updated_at     = CASE WHEN ? > ? THEN CURRENT_TIMESTAMP ELSE sync_cards.updated_at END
        `);

        const updated = [];
        for (const card of cards) {
          if (!card.card_hash || !card.status) continue;
          const inW  = weight(card.status);
          const db2  = getDb();
          const existing = db2.prepare('SELECT status FROM sync_cards WHERE card_hash=? AND group_id=?').get(card.card_hash, ws.groupId);
          const curW = weight(existing?.status || 'free');
          stmt.run(
            card.card_hash, ws.groupId, card.encrypted_data || null,
            card.status, card.notes || null, ws.installationId,
            // CASE WHEN params (new_weight > cur_weight)
            inW, curW,
            inW, curW,
            inW, curW,
            inW, curW,
            inW, curW,
          );
          updated.push({ card_hash: card.card_hash, status: card.status });
        }

        if (updated.length > 0) {
          const event = {
            type: 'card_update',
            cards: updated,
            updated_by: ws.installationId,
            updated_at: new Date().toISOString(),
          };
          // Broadcast to other WS clients in same group
          broadcastToGroup(ws.groupId, event, ws.installationId);
          // Also broadcast to Socket.io room (for browser admin)
          if (io) io.to(`group:${ws.groupId}`).emit('card:update', { cards: updated, updated_by: ws.installationId });
        }
        return;
      }

      // ── Re-check group (after joining) ────────────────────────
      if (msg.type === 'refresh_group') {
        const db = getDb();
        const member = db.prepare('SELECT group_id FROM sync_group_members WHERE installation_id = ?').get(ws.installationId);
        ws.groupId = member?.group_id || null;
        send(ws, { type: 'group_refreshed', group_id: ws.groupId });
        return;
      }
    });

    ws.on('close', () => {
      if (ws.installationId) {
        clients.delete(ws.installationId);
        if (ws.groupId) {
          broadcastToGroup(ws.groupId, { type: 'member_left', installation_id: ws.installationId }, ws.installationId);
        }
      }
    });

    ws.on('error', () => {});
  });

  // Periodic ping to keep connections alive (every 30 sec)
  setInterval(() => {
    for (const [, ws] of clients) {
      if (ws.readyState === ws.OPEN) send(ws, { type: 'ping' });
    }
  }, 30_000);
};

function broadcastToGroup(groupId, msg, excludeInstallationId) {
  for (const [iid, ws] of clients) {
    if (iid === excludeInstallationId) continue;
    if (ws.groupId === groupId && ws.readyState === ws.OPEN) {
      send(ws, msg);
    }
  }
}

function broadcastCatalogUpdate(wss, type, data) {
  const msg = JSON.stringify({ type: 'catalog_update', payload: { type, data } });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}
module.exports.broadcastCatalogUpdate = broadcastCatalogUpdate;
