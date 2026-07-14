const { URL } = require('url');

const SAFE_URL_PROTOCOLS = ['http:', 'https:'];
const DANGEROUS_URL_SCHEMES = [/^javascript:/i, /^vbscript:/i, /^data:/i, /^file:/i];

const isPrivateOrLocalHostname = (hostname) => {
  if (!hostname) return true;
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0') return true;
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('169.254.') || host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
  if (/^fc00:/i.test(host) || /^fd00:/i.test(host) || /^fe80:/i.test(host)) return true;
  return false;
};

function sanitizeUrl(value) {
  if (value === null || typeof value === 'undefined') return null;

  let normalized = value;
  if (typeof value === 'string') {
    normalized = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    normalized = String(value);
  } else if (typeof value === 'object') {
    if (value instanceof URL) {
      normalized = value.toString();
    } else if (value && typeof value.toString === 'function') {
      normalized = value.toString();
    } else {
      return null;
    }
  } else {
    return null;
  }

  const stringValue = String(normalized || '').trim();
  if (!stringValue) return null;
  if (DANGEROUS_URL_SCHEMES.some((scheme) => scheme.test(stringValue))) return null;

  let url;
  try {
    url = new URL(stringValue);
  } catch {
    return null;
  }

  if (!SAFE_URL_PROTOCOLS.includes(url.protocol)) return null;
  if (!url.hostname) return null;
  if (isPrivateOrLocalHostname(url.hostname)) return null;
  if (url.username || url.password) return null;
  return url.href;
}

function sanitizeHtmlContent(html) {
  const source = String(html || '');
  let sanitized = source;

  sanitized = sanitized.replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '');
  sanitized = sanitized.replace(/<\s*script\b[^>]*\/\s*>/gi, '');
  sanitized = sanitized.replace(/<\s*iframe\b[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '');
  sanitized = sanitized.replace(/<\s*iframe\b[^>]*\/\s*>/gi, '');
  sanitized = sanitized.replace(/<\s*object\b[^>]*>[\s\S]*?<\s*\/\s*object\s*>/gi, '');
  sanitized = sanitized.replace(/<\s*object\b[^>]*\/\s*>/gi, '');
  sanitized = sanitized.replace(/<\s*embed\b[^>]*>[\s\S]*?<\s*\/\s*embed\s*>/gi, '');
  sanitized = sanitized.replace(/<\s*embed\b[^>]*\/\s*>/gi, '');

  sanitized = sanitized.replace(/<\s*base\b[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\s*meta\b[^>]*http-equiv\b[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\s*link\b[^>]*rel\s*=\s*["']?import["']?[^>]*>/gi, '');

  sanitized = sanitized.replace(/(<[a-z][^>]*?)\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+)/gi, '$1');
  sanitized = sanitized.replace(/(<[a-z][^>]*?)\s+srcset\s*=\s*("[^"]*"|'[^']*')/gi, '$1');

  sanitized = sanitized.replace(/(<[a-z][^>]*?)\s+((?:href|src|action|formaction)\s*=\s*)("[^"]*"|'[^']*'|[^>\s]+)/gi, (match, prefix, attr, value) => {
    if (/=\s*("|'|)?\s*(javascript:|vbscript:|data:)/i.test(match)) {
      return `${prefix}${attr}""`;
    }
    return match;
  });

  sanitized = sanitized.replace(/(<[a-z][^>]*?)\s+style\s*=\s*("[^"]*"|'[^']*')/gi, (match, prefix, value) => {
    if (/expression\s*\(|url\s*\(\s*(?:javascript:|vbscript:|data:)/i.test(value)) {
      return prefix;
    }
    return match;
  });

  return sanitized;
}

module.exports = {
  sanitizeHtmlContent,
  sanitizeUrl,
};
