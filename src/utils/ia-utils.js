const JSON5 = require('json5');

// Sanitiza la respuesta del modelo para extraer únicamente el HTML completo.
function extractHtmlFromText(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();

  // Remove common markdown fences and capture inner content
  const fenceMatch = /```(?:html)?\s*([\s\S]*?)\s*```/i.exec(s);
  if (fenceMatch && fenceMatch[1]) {
    s = fenceMatch[1].trim();
  }

  // If the model wrapped the HTML inside code blocks without fences, try to find <html or <!doctype
  const startRegex = /<!doctype\s+html[^>]*>|<html[\s\S]*?>/i;
  const startMatch = startRegex.exec(s);
  if (startMatch) {
    const startIdx = startMatch.index;
    // find last </html>
    const lastHtmlClose = s.toLowerCase().lastIndexOf('</html>');
    if (lastHtmlClose !== -1) {
      return s.slice(startIdx, lastHtmlClose + 7).trim();
    }
    // if no closing tag, return from start to end
    return s.slice(startIdx).trim();
  }

  // Try to parse if the model returned a JSON object with an `html` field
  try {
    const maybeJson = s;
    const parsed = JSON5.parse(maybeJson);
    if (parsed && typeof parsed.html === 'string') return parsed.html.trim();
  } catch (e) {
    // ignore
  }

  // Lastly, if the whole text starts with <, assume it's HTML-ish and return until last </html>
  if (s.trim().startsWith('<')) {
    const lastHtmlClose = s.toLowerCase().lastIndexOf('</html>');
    if (lastHtmlClose !== -1) return s.slice(0, lastHtmlClose + 7).trim();
    return s;
  }

  return null;
}

function sanitizeAIResponse(raw) {
  if (!raw) return null;
  // Remove Backticks wrappers
  let cleaned = raw.replace(/^\s*```[\s\S]*?```\s*$/g, (m) => m.replace(/```/g, ''));
  // Try to extract HTML
  const html = extractHtmlFromText(cleaned);
  if (!html) return null;
  // Basic normalization: ensure it starts with DOCTYPE or <html
  const normalized = html.trim();
  if (!/^(?:<!doctype\s+html)|<html/i.test(normalized)) return null;
  return normalized;
}

module.exports = { sanitizeAIResponse, extractHtmlFromText };
