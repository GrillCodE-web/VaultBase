// 7rn: лёгкие метрики без внешних зависимостей (prom-client не тянем).
// Считаем HTTP-запросы по методу и классу статуса, длительности в гистограмму
// с фиксированными бакетами, плюс отдаём процессные показатели. Формат —
// Prometheus text exposition v0.0.4, чтобы /metrics читался любым скрапером.
//
// Метки специально грубые (method + status-класс), без пути: полный путь
// расширяет кардинальность и может утечь идентификаторы (installation_id и т.п.)
// в имена серий — на слепом релее это нежелательно.

const startedAt = Date.now();

// Секунды. Верхний +Inf добавляется при рендере.
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// key = `${method}\u0000${statusClass}` → { count, sum, buckets:number[] }
const series = new Map();

function statusClass(status) {
  const s = Number(status) || 0;
  if (s >= 500) return '5xx';
  if (s >= 400) return '4xx';
  if (s >= 300) return '3xx';
  if (s >= 200) return '2xx';
  return 'other';
}

function normMethod(method) {
  const m = String(method || 'UNKNOWN').toUpperCase();
  // Ограничиваем множество, чтобы произвольные строки не раздували кардинальность.
  const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  return allowed.includes(m) ? m : 'OTHER';
}

// Учесть один завершённый запрос.
function observe(method, status, seconds) {
  const key = `${normMethod(method)}\u0000${statusClass(status)}`;
  let s = series.get(key);
  if (!s) {
    s = { count: 0, sum: 0, buckets: new Array(BUCKETS.length).fill(0) };
    series.set(key, s);
  }
  s.count += 1;
  s.sum += seconds;
  for (let i = 0; i < BUCKETS.length; i += 1) {
    if (seconds <= BUCKETS[i]) s.buckets[i] += 1;
  }
}

// Express-middleware: замеряет время до res.finish и учитывает запрос.
// /metrics и /health из учёта исключаем — это шум мониторинга.
function middleware(req, res, next) {
  const p = req.path || '';
  if (p === '/metrics' || p === '/health') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    observe(req.method, res.statusCode, seconds);
  });
  next();
}

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Отрисовать все метрики в Prometheus text-формате.
function render() {
  const lines = [];

  lines.push('# HELP vaultbase_http_requests_total Total HTTP requests handled.');
  lines.push('# TYPE vaultbase_http_requests_total counter');
  for (const [key, s] of series) {
    const [method, cls] = key.split('\u0000');
    lines.push(`vaultbase_http_requests_total{method="${esc(method)}",status="${esc(cls)}"} ${s.count}`);
  }

  lines.push('# HELP vaultbase_http_request_duration_seconds HTTP request latency.');
  lines.push('# TYPE vaultbase_http_request_duration_seconds histogram');
  for (const [key, s] of series) {
    const [method, cls] = key.split('\u0000');
    const labels = `method="${esc(method)}",status="${esc(cls)}"`;
    for (let i = 0; i < BUCKETS.length; i += 1) {
      lines.push(`vaultbase_http_request_duration_seconds_bucket{${labels},le="${BUCKETS[i]}"} ${s.buckets[i]}`);
    }
    lines.push(`vaultbase_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${s.count}`);
    lines.push(`vaultbase_http_request_duration_seconds_sum{${labels}} ${s.sum}`);
    lines.push(`vaultbase_http_request_duration_seconds_count{${labels}} ${s.count}`);
  }

  const mem = process.memoryUsage();
  lines.push('# HELP vaultbase_process_uptime_seconds Process uptime.');
  lines.push('# TYPE vaultbase_process_uptime_seconds gauge');
  lines.push(`vaultbase_process_uptime_seconds ${(Date.now() - startedAt) / 1000}`);
  lines.push('# HELP vaultbase_process_resident_memory_bytes Resident set size.');
  lines.push('# TYPE vaultbase_process_resident_memory_bytes gauge');
  lines.push(`vaultbase_process_resident_memory_bytes ${mem.rss}`);
  lines.push('# HELP vaultbase_process_heap_used_bytes Heap in use.');
  lines.push('# TYPE vaultbase_process_heap_used_bytes gauge');
  lines.push(`vaultbase_process_heap_used_bytes ${mem.heapUsed}`);

  return lines.join('\n') + '\n';
}

// Только для тестов: сбросить накопленные счётчики.
function reset() {
  series.clear();
}

module.exports = { middleware, render, observe, reset, CONTENT_TYPE: 'text/plain; version=0.0.4; charset=utf-8' };
