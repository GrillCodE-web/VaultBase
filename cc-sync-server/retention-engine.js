// MGR-021: retention телеметрии. Сервер — только транзит конвертов: менеджер
// забирает отчёты, расшифровывает и хранит локально (плюс месячные rollups),
// поэтому старые конверты на сервере лишь раздувают БД. Чистим:
//   - stats_reports           — по report_date (данные за дату, не день приёма);
//   - worker_heartbeat_history — история тиков heartbeat.
// worker_heartbeats не растёт (одна строка на воркера) и не трогается.
const { getDb } = require('./database');

const REPORTS_RETENTION_DAYS = Math.max(7, parseInt(process.env.TELEMETRY_RETENTION_DAYS || '45', 10) || 45);
const HB_HISTORY_RETENTION_DAYS = Math.max(7, parseInt(process.env.HB_HISTORY_RETENTION_DAYS || '30', 10) || 30);
const INTERVAL_MS = 60 * 60 * 1000; // раз в час достаточно, объёмы маленькие

let timer = null;

function tick() {
  try {
    const db = getDb();
    const reports = db
      .prepare("DELETE FROM stats_reports WHERE report_date < date('now', ?)")
      .run(`-${REPORTS_RETENTION_DAYS} days`);
    const hb = db
      .prepare("DELETE FROM worker_heartbeat_history WHERE ts < datetime('now', ?)")
      .run(`-${HB_HISTORY_RETENTION_DAYS} days`);
    if (reports.changes > 0 || hb.changes > 0) {
      console.log(`[retention] stats_reports -${reports.changes}, hb_history -${hb.changes}`);
    }
    return { reports: reports.changes, hb_history: hb.changes };
  } catch (e) {
    console.error('[retention] tick failed:', e.message);
    return { reports: 0, hb_history: 0 };
  }
}

function start() {
  if (!timer) {
    tick();
    timer = setInterval(tick, INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }
}

function shutdown() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, shutdown, tick, REPORTS_RETENTION_DAYS, HB_HISTORY_RETENTION_DAYS };
