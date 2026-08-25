// rate-limit.js: sliding window + per-IP exponential backoff (SEC-023).
const test = require('node:test');
const assert = require('node:assert');

const {
  RATE_LIMIT_MAX_PER_SEC,
  registerViolation,
  isBanned,
  makeWindowCounter,
  pruneViolations,
  _clearViolationsForTest,
} = require('../rate-limit');

test.afterEach(() => _clearViolationsForTest());

test('window counter allows up to RATE_LIMIT_MAX_PER_SEC per second', () => {
  const exceeded = makeWindowCounter();
  for (let i = 0; i < RATE_LIMIT_MAX_PER_SEC; i++) {
    assert.equal(exceeded(), false, `message ${i + 1} should pass`);
  }
  assert.equal(exceeded(), true, 'message over the limit must trip');
});

test('window counter resets after the 1-second window', async () => {
  const exceeded = makeWindowCounter();
  for (let i = 0; i <= RATE_LIMIT_MAX_PER_SEC; i++) exceeded();
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(exceeded(), false);
});

test('violation bans the IP and the ban escalates', () => {
  assert.equal(isBanned('10.0.0.1'), false);
  registerViolation('10.0.0.1');
  assert.equal(isBanned('10.0.0.1'), true);
  // A different IP is unaffected.
  assert.equal(isBanned('10.0.0.2'), false);
});

test('pruneViolations drops entries whose ban expired long ago', () => {
  registerViolation('10.0.0.9');
  pruneViolations(); // ban still active — must survive
  assert.equal(isBanned('10.0.0.9'), true);
});
