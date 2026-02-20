const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function safeSlice(v, n=2000) { try { return String(v).slice(0,n); } catch { return null; } }

router.post('/ai-apply-report', async (req, res) => {
  try {
    const body = req.body || {};
    const { executed = [], reasoning = '', confidence = null, meta = {} } = body;

    // minimal validation
    if (!Array.isArray(executed)) return res.status(400).json({ error: 'invalid executed array' });

    const logsDir = path.resolve(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const file = path.join(logsDir, 'ai-apply-report.log');
    const entry = {
      ts: new Date().toISOString(),
      executedCount: executed.length,
      executed: executed.slice(0,50),
      reasoning: safeSlice(reasoning, 2000),
      confidence: confidence,
      meta: (meta && typeof meta === 'object') ? meta : null,
    };
    fs.appendFile(file, JSON.stringify(entry) + '\n', (err) => { if (err) console.error('[ai-apply-report] log write failed', err); });
    console.log('[ai-apply-report] logged executed actions=', executed.length);
    return res.json({ success: true });
  } catch (e) {
    console.error('[ai-apply-report] error', e && (e.stack || e.message || e));
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
