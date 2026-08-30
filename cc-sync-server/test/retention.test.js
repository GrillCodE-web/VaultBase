const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-retention-')), 'test.db');

const { getDb } = require('../database');
const retention = require('../retention-engine');

function seedReports(db) {
  const ins = db.prepare(`
    INSERT INTO stats_reports (installation_id, kind, report_date, key_id, envelopes)
    VALUES (?, ?, ?, 1, '[]')
  `);
  // Старые (должны быть удалены) и свежие (должны остаться)
  ins.run('wrk-1', 'daily_stats', '2020-01-15');
  ins.run('wrk-1', 'activity_tail', '2020-01-15');
  ins.run('wrk-2', 'daily_stats', '2020-06-30');
  const today = new Date().toISOString().slice(0, 10);
  ins.run('wrk-1', 'daily_stats', today);
  ins.run('wrk-2', 'daily_stats', today);
}

function seedHeartbeatHistory(db) {
  const ins = db.prepare('INSERT INTO worker_heartbeat_history (installation_id, ts) VALUES (?, ?)');
  ins.run('wrk-1', '2020-01-15 10:00:00');
  ins.run('wrk-1', '2020-06-30 23:59:59');
  ins.run('wrk-1', new Date().toISOString().slice(0, 19).replace('T', ' '));
}

test('retention: старые конверты и история heartbeat удаляются, свежие остаются', () => {
  const db = getDb();
  seedReports(db);
  seedHeartbeatHistory(db);

  const before = {
    reports: db.prepare('SELECT COUNT(*) AS n FROM stats_reports').get().n,
    hb: db.prepare('SELECT COUNT(*) AS n FROM worker_heartbeat_history').get().n,
  };
  assert.strictEqual(before.reports, 5);
  assert.strictEqual(before.hb, 3);

  const res = retention.tick();
  assert.strictEqual(res.reports, 3);
  assert.strictEqual(res.hb_history, 2);

  const left = db.prepare('SELECT installation_id, kind, report_date FROM stats_reports ORDER BY 1').all();
  assert.strictEqual(left.length, 2);
  assert.ok(left.every((r) => r.report_date >= new Date(Date.now() - 86400000).toISOString().slice(0, 10)));

  const hbLeft = db.prepare('SELECT COUNT(*) AS n FROM worker_heartbeat_history').get().n;
  assert.strictEqual(hbLeft, 1);
});

test('retention: повторный tick идемпотентен (ничего не удаляет)', () => {
  const res = retention.tick();
  assert.strictEqual(res.reports, 0);
  assert.strictEqual(res.hb_history, 0);
});

test('retention: worker_heartbeats (последний конверт) не трогается', () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO worker_heartbeats (installation_id, last_seen, key_id, envelope, received_at)
    VALUES ('wrk-old', '2020-01-01 00:00:00', 1, '[]', '2020-01-01 00:00:00')
  `).run();
  retention.tick();
  const n = db.prepare("SELECT COUNT(*) AS n FROM worker_heartbeats WHERE installation_id = 'wrk-old'").get().n;
  assert.strictEqual(n, 1);
});

test('retention: start/shutdown не падают и не плодят таймеры', () => {
  retention.start();
  retention.start();
  retention.shutdown();
  retention.shutdown();
});
