//! SEC-023: per-connection sliding-window rate limit + per-IP exponential
//! backoff. Shared by ws-tauri.js (raw WS) and socket.js (Socket.io) so a ban
//! earned on one channel applies to the other too.

// Limit is 20 msg/sec: normal clients send a handful of messages per sync
// cycle; anything above that only enabled abuse.
const RATE_LIMIT_MAX_PER_SEC = 20;

// ip -> { count, bannedUntil }. Each violation doubles the ban: 10s, 20s, 40s, ...
// capped at 1 hour. Entries are pruned 1h after the ban expires.
const ipViolations = new Map();

function registerViolation(ip) {
  const e = ipViolations.get(ip) || { count: 0, bannedUntil: 0 };
  e.count += 1;
  e.bannedUntil = Date.now() + Math.min(2 ** e.count * 5000, 3_600_000);
  ipViolations.set(ip, e);
}

function isBanned(ip) {
  const e = ipViolations.get(ip);
  return !!e && e.bannedUntil > Date.now();
}

/** Sliding 1-second window counter; returns true once the caller exceeds the limit. */
function makeWindowCounter() {
  let windowStart = 0;
  let count = 0;
  return function exceeded() {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count > RATE_LIMIT_MAX_PER_SEC;
  };
}

// Prune cooled-down violation entries (ban expired more than 1h ago)
function pruneViolations() {
  const cutoff = Date.now() - 3_600_000;
  for (const [ip, e] of ipViolations) {
    if (e.bannedUntil < cutoff) ipViolations.delete(ip);
  }
}

module.exports = {
  RATE_LIMIT_MAX_PER_SEC,
  registerViolation,
  isBanned,
  makeWindowCounter,
  pruneViolations,
  // Test-only: reset per-IP backoff state.
  _clearViolationsForTest: () => ipViolations.clear(),
};
