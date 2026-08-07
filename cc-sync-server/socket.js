const { Server } = require('socket.io');
const { getDb } = require('./database');

const activeConnections = new Map();
const eventLog = [];

const STATUS_WEIGHT = { dead: 5, declined: 4, archive: 3, in_use: 2, free: 1 };
const VALID_STATUSES = ['free', 'in_use', 'archive', 'declined', 'dead'];

/** SQL expression computing the monotonic status weight of `col`. */
function weightExpr(col) {
  return Object.entries(STATUS_WEIGHT)
    .map(([s, w]) => `${w} * (${col}='${s}')`)
    .join(' + ');
}

/**
 * Apply a batch of card updates atomically.
 *
 * The conflict resolver uses monotonic status weights (higher always wins), so a
 * partially-applied batch can never be repaired by a later sync — the client
 * believes it already pushed those rows. All writes therefore go through a single
 * better-sqlite3 transaction. Transactions are synchronous: nothing inside the
 * transaction callback may await.
 *
 * @returns {Array<{card_hash: string, status: string}>} rows that were written
 */
function applyCardPush(db, groupId, installationId, cards) {
  const cur = weightExpr('status');
  const inc = weightExpr('excluded.status');
  const stmt = db.prepare(`
    INSERT INTO sync_cards (card_hash, group_id, encrypted_data, status, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(card_hash, group_id) DO UPDATE SET
      encrypted_data = CASE WHEN (${cur}) >= (${inc}) THEN sync_cards.encrypted_data ELSE excluded.encrypted_data END,
      status         = CASE WHEN (${cur}) >= (${inc}) THEN sync_cards.status         ELSE excluded.status         END,
      notes          = CASE WHEN (${cur}) >= (${inc}) THEN sync_cards.notes          ELSE excluded.notes          END,
      updated_by     = excluded.updated_by,
      updated_at     = CURRENT_TIMESTAMP
  `);

  return db.transaction(() => {
    const written = [];
    for (const card of cards) {
      // FIX WS-VALIDATION-02: Strict validation of card_hash and status
      if (!card.card_hash || typeof card.card_hash !== 'string' || card.card_hash.length < 8) continue;
      if (!card.status || !VALID_STATUSES.includes(card.status)) continue;
      const notes = typeof card.notes === 'string' ? card.notes.slice(0, 500) : null;
      stmt.run(card.card_hash, groupId, card.encrypted_data || null, card.status, notes, installationId);
      written.push({ card_hash: card.card_hash, status: card.status });
    }
    return written;
  })();
}

function logSocketEvent(type, data) {
  eventLog.push({ type, data: typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : String(data), ts: new Date().toISOString() });
  if (eventLog.length > 100) eventLog.shift();
}

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    // FIX API-11: Restrict CORS to known origins - default to localhost for dev, require env var in prod
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? (process.env.WS_ALLOWED_ORIGINS?.split(',') || [])
        : ['http://localhost:5173', 'http://localhost:1420'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    // FIX WS-MAXPAYLOAD-01: Limit message size to prevent DoS
    maxHttpBufferSize: 1e6, // 1MB max
  });

  // Map: token → { socket_id, group_id, installation_id }
  const tokenMap = new Map();

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.['x-license-token'];
    if (!token) return next(new Error('missing_token'));
    const db = getDb();
    const row = db.prepare('SELECT token, is_active, installation_id FROM licenses WHERE token = ?').get(token);
    if (!row || !row.is_active) return next(new Error('invalid_token'));
    socket.userToken = token;
    socket.installationId = row.installation_id;
    // Update last_seen
    db.prepare('UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token = ?').run(token);
    next();
  });

  io.on('connection', (socket) => {
    const db = getDb();
    // Find group for this user
    const member = db.prepare(`
      SELECT sgm.group_id FROM sync_group_members sgm
      JOIN licenses l ON l.installation_id = sgm.installation_id
      WHERE l.token = ?
    `).get(socket.userToken);

    if (member) {
      socket.groupId = member.group_id;
      socket.join(`group:${member.group_id}`);
      // Notify others
      socket.to(`group:${member.group_id}`).emit('group:member_joined', {
        installation_id: socket.installationId,
      });
    }

    tokenMap.set(socket.userToken, {
      socket_id: socket.id,
      group_id: member?.group_id,
      installation_id: socket.installationId,
    });

    // Track active connection
    activeConnections.set(socket.id, {
      installation_id: socket.installationId || null,
      group_id: member?.group_id || null,
      connected_at: new Date().toISOString(),
      last_event: null,
      ip: socket.handshake.address,
    });
    logSocketEvent('connect', { socketId: socket.id, installation_id: socket.installationId });

    // Client requests full sync on connect
    socket.on('sync:full_pull', () => {
      const conn = activeConnections.get(socket.id);
      if (conn) conn.last_event = 'sync:full_pull';
      logSocketEvent('sync:full_pull', { socketId: socket.id });
      if (!socket.groupId) return;
      const cards = db.prepare(`
        SELECT card_hash, encrypted_data, status, notes, updated_by, updated_at
        FROM sync_cards WHERE group_id = ? ORDER BY updated_at DESC
      `).all(socket.groupId);
      socket.emit('sync:full_data', { cards });
    });

    // Client pushes card updates
    socket.on('sync:push', (data) => {
      const conn = activeConnections.get(socket.id);
      if (conn) conn.last_event = 'sync:push';
      logSocketEvent('sync:push', { socketId: socket.id, count: (data?.cards?.length) || 0 });
      if (!socket.groupId) return;
      const { cards } = data || {};
      if (!Array.isArray(cards)) return;
      // FIX WS-VALIDATION-01: Validate card data before processing
      if (cards.length > 100) {
        socket.emit('error', { message: 'too_many_cards' });
        return;
      }

      let results;
      try {
        results = applyCardPush(db, socket.groupId, socket.installationId, cards);
      } catch (e) {
        console.error('[socket] card push transaction failed:', e.message);
        socket.emit('error', { message: 'push_failed' });
        return;
      }

      // Broadcast to others in the group
      if (results.length > 0) {
        socket.to(`group:${socket.groupId}`).emit('card:update', {
          cards: results,
          updated_by: socket.installationId,
          updated_at: new Date().toISOString(),
        });
      }
    });

    socket.on('disconnect', () => {
      activeConnections.delete(socket.id);
      logSocketEvent('disconnect', { socketId: socket.id, installation_id: socket.installationId });
      tokenMap.delete(socket.userToken);
      if (socket.groupId) {
        socket.to(`group:${socket.groupId}`).emit('group:member_left', {
          installation_id: socket.installationId,
        });
      }
    });
  });

  // Export emit helper for HTTP routes
  io.emitToGroup = (group_id, event, data) => {
    io.to(`group:${group_id}`).emit(event, data);
  };

  return io;
}

module.exports = { init: initSocket, activeConnections, eventLog };
