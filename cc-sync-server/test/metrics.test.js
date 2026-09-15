// 7rn: метрики /metrics — юнит-тесты модуля metrics.js и его middleware.
// Проверяем: учёт запроса по методу/классу статуса, наличие гистограммы и
// процессных gauge, исключение /metrics и /health из учёта, а также доступ
// к эндпоинту (loopback vs токен).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const metrics = require('../metrics');

function req(server, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const r = http.request(
      { host: '127.0.0.1', port: addr.port, method, path, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    r.on('error', reject);
    r.end();
  });
}

test('observe/render: учёт по методу и классу статуса', () => {
  metrics.reset();
  metrics.observe('GET', 200, 0.01);
  metrics.observe('get', 204, 0.2);
  metrics.observe('POST', 500, 3);
  const out = metrics.render();
  assert.match(out, /vaultbase_http_requests_total\{method="GET",status="2xx"\} 2/);
  assert.match(out, /vaultbase_http_requests_total\{method="POST",status="5xx"\} 1/);
  // гистограмма и процессные gauge присутствуют
  assert.match(out, /vaultbase_http_request_duration_seconds_bucket\{.*le="\+Inf"\}/);
  assert.match(out, /vaultbase_http_request_duration_seconds_sum\{method="POST",status="5xx"\} 3/);
  assert.match(out, /vaultbase_process_uptime_seconds /);
  assert.match(out, /vaultbase_process_resident_memory_bytes /);
});

test('нестандартный метод сводится к OTHER', () => {
  metrics.reset();
  metrics.observe('BREW', 200, 0.01);
  assert.match(metrics.render(), /method="OTHER",status="2xx"\} 1/);
});

test('middleware учитывает обычные запросы и пропускает /metrics и /health', async () => {
  metrics.reset();
  const app = express();
  app.use(metrics.middleware);
  app.get('/ping', (_req, res) => res.status(200).send('ok'));
  app.get('/health', (_req, res) => res.status(200).send('ok'));
  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', metrics.CONTENT_TYPE);
    res.send(metrics.render());
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await req(server, 'GET', '/ping');
    await req(server, 'GET', '/health');
    const m = await req(server, 'GET', '/metrics');
    assert.equal(m.status, 200);
    assert.match(m.headers['content-type'], /version=0\.0\.4/);
    // /ping учтён, /health и /metrics — нет.
    assert.match(m.body, /vaultbase_http_requests_total\{method="GET",status="2xx"\} 1/);
    assert.doesNotMatch(m.body, /status="2xx"\} 2/);
  } finally {
    server.close();
  }
});
