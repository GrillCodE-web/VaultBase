// SEC-019: приём CSP violation reports от Tauri-клиентов (report-uri).
// Репорты только логируются — это телеметрия об ошибках конфигурации CSP,
// а не действие; ничего не сохраняем в БД.
const express = require('express');
const router = express.Router();

const parseReport = express.json({
  // Браузеры шлют application/csp-report (стар.) или application/reports+json
  // (Reporting API); глобальный express.json в index.js эти типы не парсит.
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '64kb',
});

router.post('/', parseReport, (req, res) => {
  const report = req.body?.['csp-report'] || req.body;
  // body-parser ставит {} для нераспознанного Content-Type — это не репорт.
  if (!report || typeof report !== 'object' || Object.keys(report).length === 0) {
    return res.status(400).json({ error: 'invalid_report' });
  }
  console.warn('[csp-report]', JSON.stringify(report).slice(0, 2000));
  // 204 — нечего возвращать; ошибка клиенту тут не нужна.
  res.status(204).end();
});

module.exports = router;
