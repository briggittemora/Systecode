const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function safeString(v) {
  return (typeof v === 'string') ? v : JSON.stringify(v);
}

// Basic validation helpers
function validateIncoming(body) {
  if (!body || typeof body !== 'object') return 'Missing body';
  if (!body.prompt || typeof body.prompt !== 'string') return 'Missing prompt string';
  if (!body.structure || typeof body.structure !== 'object') return 'Missing structure object';
  return null;
}

// Filters and safety rules applied to model output
function sanitizeModelOutput(out) {
  const result = { reasoning: null, confidence: 0, actions: [] };
  if (!out || typeof out !== 'object') return { error: 'Invalid model output' };
  result.reasoning = safeString(out.reasoning || '');
  result.confidence = typeof out.confidence === 'number' ? out.confidence : 0;
  const actions = Array.isArray(out.actions) ? out.actions : [];

  // Remove any action that references audio or scripts, and limit to 10
  const filtered = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const sel = String(a.selector || '').toLowerCase();
    // skip anything touching audio or script
    if (sel.includes('audio') || sel.includes('video[type="audio"]')) continue;
    if (String(a.type || '').toLowerCase() === 'audio') continue;
    // avoid actions that try to modify <script> or inline event handlers
    if (sel.includes('script') || String(a.action || '').toLowerCase().includes('script')) continue;
    filtered.push(a);
    if (filtered.length >= 10) break;
  }
  result.actions = filtered;
  return result;
}

router.post('/ai-modify', async (req, res) => {
  try {
    const err = validateIncoming(req.body);
    if (err) return res.status(400).json({ error: err });

    const { prompt, structure } = req.body;

    // Build the prompt to send to the model. Keep it explicit about JSON-only output.
    const modelPrompt = `You are an assistant that only returns JSON with keys: reasoning, confidence, actions.\n` +
      `You will receive a user prompt and a website structure object (JSON).\n` +
      `Rules: never modify audio, never output text/markdown, only return valid JSON.\n` +
      `Max 10 actions. Each action: selector,type,action,value. Types: text,image,style,attribute,class.\n` +
      `Actions that touch audio or scripts must be removed. If ambiguous, prefer no-op.\n` +
      `Respond ONLY with the JSON object, no explanation.\n\n` +
      `USER PROMPT:\n${prompt}\n\nSTRUCTURE:\n${safeString(structure)}\n\n` +
      `Return the JSON now.`;

    const AI_URL = process.env.AI_API_URL || null;
    const AI_KEY = process.env.AI_API_KEY || null;
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || null;
    const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL_NAME || null;

    let modelResponseText = null;

    // Prefer OpenRouter if configured
    if (OPENROUTER_KEY) {
      try {
        const orModel = OPENROUTER_MODEL || 'gpt-4o-mini';
        const resp = await fetch('https://api.openrouter.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
          },
          body: JSON.stringify({
            model: orModel,
            messages: [
              { role: 'user', content: modelPrompt }
            ],
            max_tokens: 800,
            temperature: 0.2,
          }),
        });
        const j = await resp.json().catch(() => null);
        // OpenRouter responds with choices[].message.content
        if (j && Array.isArray(j.choices) && j.choices.length) {
          modelResponseText = j.choices[0].message && j.choices[0].message.content ? j.choices[0].message.content : JSON.stringify(j);
        } else if (j && j.output) {
          modelResponseText = typeof j.output === 'string' ? j.output : JSON.stringify(j.output);
        } else {
          modelResponseText = JSON.stringify(j || {});
        }
      } catch (e) {
        console.error('[ai-modify] OpenRouter call failed:', e && (e.message || e));
        return res.status(502).json({ error: 'AI provider (OpenRouter) request failed' });
      }

    } else if (AI_URL && AI_KEY) {
      // Generic AI endpoint configured
      const aiResp = await fetch(AI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_KEY}`,
        },
        body: JSON.stringify({ prompt: modelPrompt }),
      });
      modelResponseText = await aiResp.text();

    } else {
      // No AI configured: return a safe no-op response with reasoning placeholder
      const noop = {
        reasoning: 'AI not configured on server; no changes applied.',
        confidence: 0.0,
        actions: [],
      };
      return res.json(noop);
    }

    // Attempt to parse JSON from model. Models sometimes wrap in code fences; try to extract first JSON substring.
    let parsed = null;
    try {
      // direct parse
      parsed = JSON.parse(modelResponseText);
    } catch (e) {
      // try to extract JSON block
      const m = modelResponseText.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; }
      }
    }

    if (!parsed) return res.status(502).json({ error: 'Invalid model response', raw: modelResponseText });

    const safe = sanitizeModelOutput(parsed);
    if (safe.error) return res.status(500).json({ error: safe.error });

    // Log the model interaction and filtered actions to a log file for auditing
    try {
      const logsDir = path.resolve(__dirname, '..', '..', 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const entry = {
        ts: new Date().toISOString(),
        prompt: String(prompt).slice(0, 1000),
        structureSummary: (structure && structure.structure) ? structure.structure : structure,
        rawModelResponse: modelResponseText && String(modelResponseText).slice(0, 8000),
        parsedModelResponse: parsed,
        safeResponse: safe,
      };
      const file = path.join(logsDir, 'ai-actions.log');
      fs.appendFile(file, JSON.stringify(entry) + '\n', (err) => { if (err) console.error('[ai-modify] log write failed', err); });
      console.log('[ai-modify] logged AI response, actions=', (safe.actions || []).length);
    } catch (e) {
      console.error('[ai-modify] logging error', e && e.message);
    }

    return res.json(safe);
  } catch (e) {
    console.error('[POST /ai-modify] error:', e && (e.stack || e.message || e));
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
