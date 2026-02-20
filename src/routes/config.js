const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const dataDir = path.resolve(__dirname, '..', '..', 'data');
const phrasesFile = path.join(dataDir, 'phrases.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

router.get('/config/phrases', async (req, res) => {
  try {
    ensureDataDir();
    if (!fs.existsSync(phrasesFile)) {
      fs.writeFileSync(phrasesFile, JSON.stringify([]));
    }
    const raw = fs.readFileSync(phrasesFile, 'utf8');
    const arr = JSON.parse(raw || '[]');
    return res.json({ phrases: arr });
  } catch (e) {
    console.error('[config] GET phrases failed', e && e.message);
    return res.status(500).json({ error: 'failed' });
  }
});

router.put('/config/phrases', async (req, res) => {
  try {
    const body = req.body || {};
    const phrases = Array.isArray(body.phrases) ? body.phrases : null;
    if (!phrases) return res.status(400).json({ error: 'invalid_phrases' });
    ensureDataDir();
    fs.writeFileSync(phrasesFile, JSON.stringify(phrases, null, 2), 'utf8');
    return res.json({ ok: true });
  } catch (e) {
    console.error('[config] PUT phrases failed', e && e.message);
    return res.status(500).json({ error: 'failed' });
  }
});

// Generic GET/PUT for any variable name under data dir, safe-guarded
router.get('/config/:name', async (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return res.status(400).json({ error: 'invalid_name' });
    ensureDataDir();
    const filePath = path.join(dataDir, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([]));
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw || '[]');
    return res.json({ [name]: obj });
  } catch (e) {
    console.error('[config] GET name failed', e && e.message);
    return res.status(500).json({ error: 'failed' });
  }
});

router.put('/config/:name', async (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return res.status(400).json({ error: 'invalid_name' });
    const body = req.body || {};
    const data = Array.isArray(body) ? body : (Array.isArray(body[name]) ? body[name] : null);
    if (!Array.isArray(data)) return res.status(400).json({ error: 'invalid_data' });
    ensureDataDir();
    const filePath = path.join(dataDir, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return res.json({ ok: true });
  } catch (e) {
    console.error('[config] PUT name failed', e && e.message);
    return res.status(500).json({ error: 'failed' });
  }
});

// Pending actions management: list and confirm
router.get('/config/pending', async (req, res) => {
  try {
    ensureDataDir();
    const pendingDir = path.join(dataDir, 'pending');
    if (!fs.existsSync(pendingDir)) return res.json({ pending: [] });
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json'));
    const items = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(pendingDir, f), 'utf8')); } catch (e) { return null; }
    }).filter(Boolean);
    return res.json({ pending: items });
  } catch (e) {
    console.error('[config] GET pending failed', e && e.message);
    return res.status(500).json({ error: 'failed' });
  }
});

router.post('/config/confirm/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    ensureDataDir();
    const pendingDir = path.join(dataDir, 'pending');
    const filePath = path.join(pendingDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not_found' });
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    const varName = obj.varName;
    const act = obj.action || {};
    // extract array value from action
    const rawText = act.value || act.newText || act.replacement || act.html || '';
    const arrMatch = String(rawText).match(/\[([\s\S]*)\]/);
    if (!arrMatch) return res.status(400).json({ error: 'invalid_action' });
    const arrStr = '[' + arrMatch[1] + ']';
    let parsedArr = null;
    try { parsedArr = JSON.parse(arrStr); } catch (e) {
      try { parsedArr = JSON.parse(arrStr.replace(/'/g, '"')); } catch (e2) { parsedArr = null; }
    }
    if (!parsedArr) return res.status(400).json({ error: 'invalid_array' });
    // persist
    const outPath = path.join(dataDir, `${varName}.json`);
    fs.writeFileSync(outPath, JSON.stringify(parsedArr, null, 2), 'utf8');
    // remove pending
    try { fs.unlinkSync(filePath); } catch (e) { }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[config] POST confirm failed', e && e.message);
    return res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
