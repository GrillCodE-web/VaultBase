// SEC-019: CSP report endpoint accepts csp-report content types.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const app = express();
app.use('/csp-report', require('../routes/csp-report'));

let server;
let base;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('accepts application/csp-report and returns 204', async () => {
  const res = await fetch(`${base}/csp-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'document-uri': 'tauri://localhost', 'violated-directive': 'script-src' } }),
  });
  assert.equal(res.status, 204);
});

test('accepts application/reports+json (Reporting API) and returns 204', async () => {
  const res = await fetch(`${base}/csp-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/reports+json' },
    body: JSON.stringify([{ type: 'csp-violation', body: { blockedURL: 'inline' } }]),
  });
  assert.equal(res.status, 204);
});

test('rejects unsupported content type with 400', async () => {
  const res = await fetch(`${base}/csp-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not-json',
  });
  assert.equal(res.status, 400);
});
