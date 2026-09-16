// Единая точка для логгера pino.
// Все структурные логи уходят в stdout как NDJSON (one JSON per line) —
// их легко парсить journalctl / Loki / filebeat, и нет vendor lock-in.
// Level через env LOG_LEVEL (debug|info|warn|error), по умолчанию info.
// sensitive-поля (токены, ключи, card_payload) НИКОГДА не логируются —
// это контракт уровня приложения, а не pino redact.

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'vaultbase-sync' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
