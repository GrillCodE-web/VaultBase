const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { getDb, hashToken, getServerConfig, isKillSwitchOn } = require('../database');

const router = express.Router();

// /verify validates a bearer-equivalent license token supplied in the body, so it
// is brute-forceable and needs a limiter.
//
// Limit choice: the Tauri client (src-tauri/src/license.rs) calls /verify at
// unlock, from the 6h heartbeat and from retry_verify() behind the Settings
// "Retry Connection" button. 60 requests per IP per 15 min is far above normal
// usage even for several installations sharing one NAT egress IP, while still
// cutting online token guessing to a useless rate.
//
// Keyed on IP deliberately, NOT on the submitted token: keying on the token would
// give an attacker a fresh bucket for every guess, defeating the limiter.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
});

const PREV_TOKEN_GRACE_MS = 24 * 60 * 60 * 1000; // старый токен живёт сутки после ротации

function offlinePermitExp() {
  const hours = parseInt(getServerConfig('offline_ttl_hours', '72'), 10);
  if (!Number.isFinite(hours) || hours <= 0) return null; // офлайн запрещён политикой
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function rotateDays() {
  const d = parseInt(getServerConfig('token_rotate_days', '30'), 10);
  return Number.isFinite(d) && d > 0 ? d : 30;
}

function audit(action, details) {
  try {
    getDb().prepare(
      'INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(action, typeof details === 'string' ? details : JSON.stringify(details));
  } catch { /* audit не должен ронять verify */ }
}

// POST /verify
router.post('/', verifyLimiter, (req, res) => {
  // Kill-switch: глушим и лицензионный канал тоже (админка не затрагивается).
  if (isKillSwitchOn()) {
    return res.status(503).json({ error: 'service_halted' });
  }

  const { token, installation_id } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'missing_token' });
  }

  const db = getDb();
  const tokenHash = hashToken(token);
  let row = db.prepare(
    'SELECT installation_id, token_hash, prev_token_hash, rotated_at, label, is_active, role, last_ip, expires_at FROM licenses WHERE token_hash = ?'
  ).get(tokenHash);
  let matchedPrev = false;

  if (!row) {
    // Клиент мог пропустить ответ с ротацией (сеть оборвалась) — даём сутки
    // жизни прошлому токену, иначе легитимный клиент отваливался бы навсегда.
    row = db.prepare(
      'SELECT installation_id, token_hash, prev_token_hash, rotated_at, label, is_active, role, last_ip, expires_at FROM licenses WHERE prev_token_hash = ?'
    ).get(tokenHash);
    if (row && row.rotated_at && (Date.now() - new Date(row.rotated_at).getTime()) < PREV_TOKEN_GRACE_MS) {
      matchedPrev = true;
    } else {
      row = null;
    }
  }

  if (!row) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: 'revoked' });
  }

  // Time-bomb: просроченная лицензия мертва, даже если сервер жив.
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(403).json({ error: 'license_expired' });
  }

  // Привязка к машине: клиент шлёт installation_id, и он обязан совпадать.
  // Старые клиенты без installation_id проходят (онлайн), но офлайн-пермит
  // и ротацию не получают — стимул обновиться.
  if (installation_id && row.installation_id !== installation_id) {
    audit('device_mismatch', { expected: row.installation_id, got: installation_id, ip: req.ip });
    return res.status(401).json({ error: 'device_mismatch' });
  }

  // Алерт о смене IP (менеджер видит в журнале аудита).
  const ip = req.ip || null;
  if (ip && row.last_ip && row.last_ip !== ip) {
    audit('ip_change', { installation_id: row.installation_id, from: row.last_ip, to: ip });
  }

  // Ротация: по расписанию (token_rotate_days) или принудительно при заходе
  // по прошлому токену. Открытый токен отдаём один раз, в БД — только хеш.
  let newToken = null;
  const lastRotation = row.rotated_at ? new Date(row.rotated_at).getTime() : 0;
  const stale = !lastRotation || (Date.now() - lastRotation) > rotateDays() * 86400 * 1000;
  if (matchedPrev || stale) {
    newToken = crypto.randomBytes(32).toString('hex');
    db.prepare(
      `UPDATE licenses SET prev_token_hash = token_hash, token_hash = ?, token = NULL,
       rotated_at = CURRENT_TIMESTAMP, last_seen = CURRENT_TIMESTAMP, last_ip = ?
       WHERE installation_id = ?`
    ).run(hashToken(newToken), ip, row.installation_id);
    audit('token_rotated', { installation_id: row.installation_id, reason: matchedPrev ? 'prev_match' : 'schedule' });
  } else {
    db.prepare(
      'UPDATE licenses SET last_seen = CURRENT_TIMESTAMP, last_ip = ? WHERE installation_id = ?'
    ).run(ip, row.installation_id);
  }

  const body = {
    valid: true,
    label: row.label || '',
    role: row.role || 'operator',
    offline_until: installation_id ? offlinePermitExp() : null,
  };
  if (newToken) body.new_token = newToken;
  return res.json(body);
});

module.exports = router;
