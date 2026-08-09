const fs = require('fs');
const path = require('path');

/**
 * Обход графа импортов от реальных точек входа. Файл считается
 * мёртвым, только если до него нет пути ни от main.jsx, ни от
 * float.jsx, ни от тестов.
 */
const ROOT = 'src';
const entries = ['src/main.jsx', 'src/float.jsx'];

const all = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join('/');
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|css)$/.test(e.name)) all.push(p);
  }
};
walk(ROOT);

const resolve = (from, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(from), spec);
  const tries = [base, base + '.jsx', base + '.js', base + '.css', base + '/index.jsx', base + '/index.js'];
  return tries.find((t) => fs.existsSync(t) && fs.statSync(t).isFile()) || null;
};

const importsOf = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  for (const m of src.matchAll(/(?:from\s+|import\s+|import\()\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of src.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) specs.push(m[1]);
  return specs.map((s) => resolve(file, s)).filter(Boolean);
};

const reached = new Set();
const queue = [...entries];
while (queue.length) {
  const f = queue.pop();
  if (reached.has(f)) continue;
  reached.add(f);
  queue.push(...importsOf(f));
}

// тесты — отдельный корень: файл, нужный только тестам, не мёртвый,
// но и в бандл не попадает
const testFiles = all.filter((f) => /__tests__|\.test\./.test(f));
const testReached = new Set();
const tq = [...testFiles];
while (tq.length) {
  const f = tq.pop();
  if (testReached.has(f)) continue;
  testReached.add(f);
  tq.push(...importsOf(f));
}

const dead = all.filter((f) => !reached.has(f) && !testReached.has(f));
const onlyTests = all.filter((f) => !reached.has(f) && testReached.has(f) && !/__tests__|\.test\./.test(f));

const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').length;
const fmt = (f) => `${String(lines(f)).padStart(5)}  ${f}`;

console.log(`ДОСТИЖИМО из main.jsx/float.jsx: ${reached.size}`);
console.log(`ВСЕГО файлов в src: ${all.length}`);
console.log(`\n=== НЕ достижимо ниоткуда (${dead.length}) ===`);
console.log(dead.map(fmt).join('\n'));
console.log(`\n=== Нужно только тестам (${onlyTests.length}) ===`);
console.log(onlyTests.map(fmt).join('\n'));
console.log(`\nмёртвых строк: ${dead.reduce((s, f) => s + lines(f), 0)}`);
