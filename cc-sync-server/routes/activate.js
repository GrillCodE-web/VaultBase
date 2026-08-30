const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { getDb, hashToken } = require('../database');

const router = express.Router();

// Activation is a once-per-installation operation, and the activation key is only
// 16 hex chars of an HMAC — brute-forceable without a limiter. 10 attempts per IP
// per 15 minutes leaves ample room for a user retrying a mistyped key.
const activateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
});

/**
 * Derive the expected activation key for a given installation_id + challenge.
 * HMAC-SHA256(installation_id + challenge, SERVER_SECRET) → first 16 hex chars
 * formatted as XXXX-XXXX-XXXX-XXXX
 */
function deriveActivationKey(installation_id, challenge) {
  const secret = process.env.SERVER_SECRET;
  if (!secret) {
    throw new Error('SERVER_SECRET environment variable is not set. This is a critical security requirement.');
  }
  const raw = crypto
    .createHmac('sha256', secret)
    .update(installation_id + challenge)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

// POST /activate
router.post('/', activateLimiter, (req, res) => {
  const { installation_id, challenge, activation_key, worker_pubkey } = req.body || {};

  if (!installation_id || !challenge || !activation_key) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  // MGR-016: воркер может сразу прислать X25519-пубключ (менеджер запечатает
  // для него срезы карт). Отсутствие ключа — не ошибка (легаси-клиенты);
  // кривой формат — ошибка активации, чтобы клиент не считал ключ зарегистрированным.
  if (worker_pubkey !== undefined
      && (typeof worker_pubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(worker_pubkey))) {
    return res.status(400).json({ error: 'worker_pubkey_invalid' });
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM licenses WHERE installation_id = ? AND challenge = ?'
  ).get(installation_id, challenge);

  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: 'revoked' });
  }

  const expected = deriveActivationKey(installation_id, challenge);
  const keyBuf = Buffer.from(activation_key);
  const expBuf = Buffer.from(expected);
  if (keyBuf.length !== expBuf.length || !crypto.timingSafeEqual(keyBuf, expBuf)) {
    return res.status(401).json({ error: 'invalid_key' });
  }

  // Generate token if not already assigned. MGR-008: в БД сохраняется только
  // SHA-256 хеш (token_hash); открытый токен уходит клиенту в ответе один раз.
  let token = null;
  if (!row.token_hash) {
    token = crypto.randomBytes(32).toString('hex');
    db.prepare(
      'UPDATE licenses SET token_hash = ?, token = NULL, last_seen = CURRENT_TIMESTAMP WHERE installation_id = ?'
    ).run(hashToken(token), installation_id);
  } else {
    // Токен уже выдан, а открытый не хранится (только хеш) — вернуть его
    // повторно невозможно. Перевыпуск — через admin rotate-token.
    db.prepare(
      'UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE installation_id = ?'
    ).run(installation_id);
    return res.status(409).json({ error: 'already_activated' });
  }

  // MGR-016: сохраняем публичключ воркера, если он пришёл с активацией.
  // Один активный ключ на установку (прошлый отзывается). Регистрация
  // best-effort: сбой не срывает активацию — ключ можно зарегистрировать
  // позже через POST /sync/worker-key/register.
  if (worker_pubkey) {
    try {
      db.transaction(() => {
        db.prepare(`
          UPDATE worker_keys SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
          WHERE installation_id = ? AND is_active = 1
        `).run(installation_id);
        db.prepare('INSERT INTO worker_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
          .run(installation_id, worker_pubkey.toLowerCase(), 'activation');
      })();
      db.prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)')
        .run('worker_key_register', JSON.stringify({ installation_id, source: 'activation' }));
    } catch (e) {
      console.error('[activate] worker key registration failed:', e.message);
    }
  }

  return res.json({ token, role: row.role || 'operator' });
});

module.exports = router;
module.exports.deriveActivationKey = deriveActivationKey;
