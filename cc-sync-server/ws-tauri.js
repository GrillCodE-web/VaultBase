//! Raw WebSocket handler for Tauri desktop clients.
//! Protocol:
//!   Server → Client: {"type":"auth_challenge","nonce":"...","ts":...}  (MGR-008 anti-replay)
//!   Client → Server: {"type":"auth","token":"<license_token>","nonce":"<echo>"}
//!   Server → Client: {"type":"auth_ok","installation_id":"...","group_id":"..."}  |  {"type":"auth_error","error":"..."}
//!   Client → Server: {"type":"full_pull"}
//!   Server → Client: {"type":"full_data","cards":[...]}
//!   Client → Server: {"type":"push","cards":[{card_hash,status,notes?,encrypted_data?}]}
//!   Server → Client: {"type":"card_update","cards":[...],"updated_by":"..."}  (broadcast to group)
//!   Server → Client: {"type":"member_joined","installation_id":"..."}
//!   Server → Client: {"type":"member_left","installation_id":"..."}
//!   Client → Server: {"type":"ping"}
//!   Server → Client: {"type":"pong"}

const crypto = require('crypto');
const { getDb, hashToken, isKillSwitchOn, isWsNonceRequired } = require('./database');
const { applyCardPush, CardCreateForbiddenError, MAX_CARDS_PER_BATCH } = require('./card-push');
const { registerViolation, isBanned, makeWindowCounter, pruneViolations, _clearViolationsForTest } = require('./rate-limit');

// Map: installation_id → WebSocket
const clients = new Map();

// Keep-alive timer handle, cleared on graceful shutdown.
let pingInterval = null;
let violationPruneInterval = null;

// Mirrors index.js 'trust proxy': only a same-host proxy may supply
// X-Forwarded-For, otherwise the header is client-controlled and spoofable.
function clientIp(req) {
  const remote = req?.socket?.remoteAddress || 'unknown';
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
    const fwd = req?.headers?.['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  }
  return remote;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

module.exports = function initWsTauri(wss, io) {
  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);

    // SEC-023: IP is in a backoff ban after repeated rate-limit violations
    if (isBanned(ip)) {
      ws.close(4002, 'rate_limit_backoff');
      return;
    }

    ws.authenticated = false;
    ws.installationId = null;
    ws.groupId = null;
    // MGR-008 anti-replay: одноразовый nonce на подключение. Клиент обязан
    // вернуть его в auth (когда ws_require_nonce включён); перехваченное
    // auth-сообщение нельзя переиграть на другом подключении.
    ws.authNonce = crypto.randomBytes(16).toString('hex');
    send(ws, { type: 'auth_challenge', nonce: ws.authNonce, ts: Date.now() });
    // SEC-023: sliding 1-second window, max RATE_LIMIT_MAX_PER_SEC messages.
    const rateExceeded = makeWindowCounter();

    // Auth timeout — 10 seconds
    const authTimeout = setTimeout(() => {
      if (!ws.authenticated) ws.close(4001, 'auth_timeout');
    }, 10_000);

    ws.on('message', (raw) => {
      // SEC-023: on violation the connection is closed and the IP gets an
      // exponential backoff ban, so an abusive client cannot just reconnect.
      if (rateExceeded()) {
        registerViolation(ip);
        ws.close(4002, 'rate_limit_exceeded');
        return;
      }

      // FIX WS-MAXPAYLOAD-02: Limit message size
      if (raw.length > 1024 * 1024) { // 1MB
        ws.close(4003, 'message_too_large');
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        // Malformed frame — the only possible failure here is a SyntaxError from
        // non-JSON input. Tell the client rather than dropping it silently, so a
        // protocol mismatch is diagnosable from the client side.
        if (!(e instanceof SyntaxError)) throw e;
        send(ws, { type: 'error', error: 'malformed_json' });
        return;
      }
      if (!msg || typeof msg !== 'object') {
        send(ws, { type: 'error', error: 'malformed_json' });
        return;
      }

      // ── Auth ──────────────────────────────────────────────────
      if (msg.type === 'auth') {
        clearTimeout(authTimeout);
        const token = msg.token?.trim();
        if (!token) { send(ws, { type: 'auth_error', error: 'missing_token' }); ws.close(); return; }

        // MGR-008 anti-replay: nonce одноразовый — снимаем его с сокета при
        // первой попытке auth. В режиме ws_require_nonce неверный/отсутствующий
        // nonce отклоняется; пока флаг выкл — старые клиенты работают как есть.
        const expectedNonce = ws.authNonce;
        ws.authNonce = null;
        if (isWsNonceRequired() && msg.nonce !== expectedNonce) {
          send(ws, { type: 'auth_error', error: 'bad_nonce' });
          ws.close();
          return;
        }

        // MGR-008 kill-switch: воркерский WS-канал глушится.
        if (isKillSwitchOn()) {
          send(ws, { type: 'auth_error', error: 'service_halted' });
          ws.close();
          return;
        }

        const db = getDb();
        // SEC-022: license check + last_seen + group lookup run in one
        // transaction. Previously a license deactivated between the SELECT and
        // the UPDATE still authenticated this socket (TOCTOU).
        // MGR-008: lookup по SHA-256 хешу токена — открытых токенов в БД нет.
        const tokenHash = hashToken(token);
        const authTx = db.transaction((th) => {
          const row = db.prepare(
            'SELECT installation_id, is_active, role FROM licenses WHERE token_hash = ?'
          ).get(th);
          if (!row || !row.is_active) return null;
          // Manager licenses never join the card-sync WS channel.
          if (row.role === 'manager') return { forbidden: 'manager_ws_forbidden' };
          // Worker policy ban (worker_policies) applies at connection auth too.
          const banned = db.prepare(
            "SELECT banned_reason FROM worker_policies WHERE installation_id = ? AND banned = 1 AND (ban_until IS NULL OR ban_until > datetime('now'))"
          ).get(row.installation_id);
          if (banned) return { banned: banned.banned_reason || '' };
          db.prepare('UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token_hash = ?').run(th);
          const member = db.prepare(`
            SELECT sgm.group_id FROM sync_group_members sgm
            WHERE sgm.installation_id = ?
          `).get(row.installation_id);
          return { installationId: row.installation_id, groupId: member?.group_id || null };
        });
        let auth;
        try {
          auth = authTx(tokenHash);
        } catch (e) {
          // A failing DB (locked, IO error) must answer the client instead of an
          // uncaught throw that leaves the socket hanging until auth_timeout.
          console.error('[ws-tauri] auth transaction failed:', e.message);
          send(ws, { type: 'auth_error', error: 'internal_error' });
          ws.close();
          return;
        }

        if (!auth) {
          send(ws, { type: 'auth_error', error: 'invalid_token' });
          ws.close();
          return;
        }
        if (auth.forbidden) {
          send(ws, { type: 'auth_error', error: auth.forbidden });
          ws.close();
          return;
        }
        if (auth.banned !== undefined) {
          send(ws, { type: 'auth_error', error: 'banned', reason: auth.banned });
          ws.close();
          return;
        }

        ws.authenticated = true;
        ws.installationId = auth.installationId;
        ws.userToken = tokenHash;
        ws.groupId = auth.groupId;

        // FIX: повторное подключение той же installation_id раньше молча
        // перезаписывало clients-запись, а close СТАРОГО сокета потом удалял
        // запись НОВОГО — broadcast-ы группе переставали доходить до живого
        // клиента. Закрываем старый сокет и помечаем его, чтобы его close-
        // хендлер не трогал чужую запись.
        const prev = clients.get(auth.installationId);
        if (prev && prev !== ws) {
          prev.replaced = true;
          try { prev.close(4004, 'replaced_by_new_connection'); } catch { /* already closing */ }
        }
        clients.set(auth.installationId, ws);

        send(ws, {
          type: 'auth_ok',
          installation_id: auth.installationId,
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
        let cards;
        let courierTags = [];
        try {
          cards = db.prepare(
            'SELECT card_hash, encrypted_data, status, notes, updated_by, updated_at FROM sync_cards WHERE group_id = ? ORDER BY updated_at DESC'
          ).all(ws.groupId);
          // FEAT-010: теги курьеров группы (таблица появилась в user_version 12)
          courierTags = db.prepare(
            'SELECT provider, courier_hash, tag, action, updated_by, updated_at FROM sync_courier_tags WHERE group_id = ? ORDER BY updated_at DESC'
          ).all(ws.groupId);
        } catch (e) {
          console.error('[ws-tauri] full_pull failed:', e.message);
          send(ws, { type: 'error', error: 'internal_error' });
          return;
        }
        send(ws, { type: 'full_data', cards, courier_tags: courierTags });
        return;
      }

      // ── Push card updates ──────────────────────────────────────
      if (msg.type === 'push') {
        if (!ws.groupId) { send(ws, { type: 'error', error: 'not_in_group' }); return; }
        const { cards } = msg;
        if (!Array.isArray(cards)) return;
        // FIX WS-VALIDATION-03: Validate batch size
        if (cards.length > MAX_CARDS_PER_BATCH) {
          send(ws, { type: 'error', error: 'too_many_cards' });
          return;
        }

        let updated;
        try {
          // MGR-016: воркер — потребитель, создание карт запрещено (только
          // обновления статусов существующих карт; новые раздаёт менеджер).
          updated = applyCardPush(getDb(), ws.groupId, ws.installationId, cards, { allowCreate: false });
        } catch (e) {
          if (e instanceof CardCreateForbiddenError) {
            send(ws, { type: 'error', error: 'cards_import_disabled' });
            return;
          }
          console.error('[ws-tauri] card push transaction failed:', e.message);
          send(ws, { type: 'error', error: 'push_failed' });
          return;
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
        let member;
        try {
          member = db.prepare('SELECT group_id FROM sync_group_members WHERE installation_id = ?').get(ws.installationId);
        } catch (e) {
          console.error('[ws-tauri] refresh_group failed:', e.message);
          send(ws, { type: 'error', error: 'internal_error' });
          return;
        }
        ws.groupId = member?.group_id || null;
        send(ws, { type: 'group_refreshed', group_id: ws.groupId });
        return;
      }
    });

    ws.on('close', () => {
      if (ws.installationId && !ws.replaced) {
        // Удаляем запись, только если она всё ещё указывает на ЭТОТ сокет —
        // иначе сотрём регистрацию более нового подключения того же клиента.
        if (clients.get(ws.installationId) === ws) clients.delete(ws.installationId);
        if (ws.groupId) {
          broadcastToGroup(ws.groupId, { type: 'member_left', installation_id: ws.installationId }, ws.installationId);
        }
      }
    });

    // Socket-level transport errors (ECONNRESET on abrupt client exit, protocol
    // framing errors, TLS failures). The 'close' handler still runs afterwards
    // and performs cleanup, so this only needs to record the cause.
    ws.on('error', (err) => {
      const iid = ws.installationId || 'unauthenticated';
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        console.warn(`[ws-tauri] client ${iid} dropped connection: ${err.code}`);
        return;
      }
      console.error(`[ws-tauri] socket error for ${iid}: ${err.message}`);
    });
  });

  // Periodic ping to keep connections alive (every 30 sec)
  pingInterval = setInterval(() => {
    for (const [, ws] of clients) {
      if (ws.readyState === ws.OPEN) send(ws, { type: 'ping' });
    }
  }, 30_000);

  // Prune cooled-down violation entries (ban expired more than 1h ago)
  violationPruneInterval = setInterval(pruneViolations, 60_000);
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
    if (client.readyState === 1 && client.authenticated) client.send(msg);
  });
}
module.exports.broadcastCatalogUpdate = broadcastCatalogUpdate;

// Targeted delivery to one installation (used for policy_update pushes).
function sendToInstallation(iid, msg) {
  const ws = clients.get(iid);
  if (ws && ws.readyState === ws.OPEN) {
    send(ws, msg);
    return true;
  }
  return false;
}

// Broadcast to every authenticated WS client (used for news pushes).
function broadcastAll(wss, msg) {
  if (!wss) return;
  const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.authenticated) client.send(raw);
  });
}
module.exports.sendToInstallation = sendToInstallation;
module.exports.broadcastAll = broadcastAll;
// FEAT-010: маршруту /sync/courier_tag нужен group-scoped broadcast.
module.exports.broadcastToGroup = broadcastToGroup;

// REDESIGN-05-5B2: presence для панели воркеров — снимок онлайн-подключений
// (installation_id → group_id). Только метаданные подключений, без контента.
function getOnlineInstallations() {
  const out = [];
  for (const [iid, ws] of clients) {
    if (ws.readyState === ws.OPEN && ws.authenticated) {
      out.push({ installation_id: iid, group_id: ws.groupId || null });
    }
  }
  return out;
}
module.exports.getOnlineInstallations = getOnlineInstallations;
// Test-only: reset per-IP backoff state.
module.exports._clearViolationsForTest = _clearViolationsForTest;

/** Stop the keep-alive timer and close every tracked client. Used on shutdown. */
function shutdown() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (violationPruneInterval) {
    clearInterval(violationPruneInterval);
    violationPruneInterval = null;
  }
  for (const [, ws] of clients) {
    if (ws.readyState === ws.OPEN) ws.close(1001, 'server_shutdown');
  }
  clients.clear();
}
module.exports.shutdown = shutdown;
