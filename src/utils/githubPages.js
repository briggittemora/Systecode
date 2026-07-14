function normalizeGitHubPagesPathSegment(value, fallback = 'file') {
  const input = String(value || '').trim();
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function normalizeGitHubPagesFilename(value, fallback = 'file.html') {
  const input = String(value || '').trim();
  const withoutExt = input.replace(/\.html?$/i, '').trim();
  const filenameSegment = normalizeGitHubPagesPathSegment(withoutExt, fallback.replace(/\.html?$/i, 'file'));
  return `${filenameSegment}.html`;
}

function extractGitHubPagesRelativePath(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    // Para mantener compatibilidad si hay archivos viejos en 'files/'
    const filesIndex = segments.findIndex((segment) => segment.toLowerCase() === 'files');
    if (filesIndex !== -1) return segments.slice(filesIndex).join('/');
    
    // Si no está en 'files/', simplemente devuelve el nombre del archivo al final de la URL
    return segments.length > 0 ? segments[segments.length - 1] : null;
  } catch {
    return null;
  }
}

function extractGitHubPagesPathId(path) {
  if (!path || typeof path !== 'string') return null;
  const normalized = String(path).trim().replace(/^\/+/, '');
  // Modificado para capturar el ID ya sea "files/524_" o directamente "524-" en la raíz
  const match = normalized.match(/(?:^|\/)(?:files\/)?(\w+)[_-]/i);
  return match ? match[1] : null;
}

function buildStorageHtmlPath({ id, originalName, existingPath, userId, personalization }) {
  const baseId = String(id || '').trim();
  const safeName = sanitizeStorageObjectName(originalName, 'file.html');
  if (existingPath && typeof existingPath === 'string' && existingPath.trim()) {
    const trimmed = existingPath.trim();
    if (trimmed.startsWith('html/')) return trimmed;
    if (trimmed.startsWith('/html/')) return trimmed.replace(/^\/+/, '');
  }

  if (personalization && userId) {
    const safeUserId = String(userId).trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
    return `html/${safeUserId}_${baseId}_${safeName}`;
  }

  if (baseId) return `html/${baseId}_${safeName}`;
  return `html/${safeName}`;
}

function buildGitHubPagesFilePath({ id, name, preferredFilename, existingUrl, existingPath, userId, personalization, timestamp }) {
  const baseId = String(id || '').trim() || `${Date.now()}`;
  
  // 1. SOLUCIÓN AL [object Object]: Si envían un objeto por error, extraemos el nombre real
  let rawNameObj = preferredFilename || name || '';
  if (typeof rawNameObj === 'object' && rawNameObj !== null) {
    rawNameObj = rawNameObj.name || rawNameObj.title || rawNameObj.originalName || 'archivo';
  }
  const rawName = String(rawNameObj).trim();

  const filename = normalizeGitHubPagesFilename(rawName, `${baseId}.html`);
  const basename = filename.replace(/\.html$/i, '');
  const safeTimestamp = String(timestamp || Date.now()).trim();

  // 2. SOLUCIÓN A LA ESTRUCTURA DE LA URL: Generar formato limpio sin la carpeta "files/"
  if (personalization && userId) {
    const safeUserId = String(userId).trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
    const safeBaseName = normalizeGitHubPagesPathSegment(basename.replace(/^\d+_?/, ''), 'archivo');
    
    // Retorna: 524-usuario-galaxia-para-ti-1782973615598.html
    return `${safeUserId}-${safeBaseName}-${safeTimestamp}.html`;
  }

  // --- Lógicas alternativas adaptadas para no forzar 'files/' ---
  if (String(id).trim() === '580') {
    const fallbackPath = existingUrl || existingPath ? (extractGitHubPagesRelativePath(existingUrl || existingPath) || null) : null;
    if (fallbackPath) return fallbackPath.replace(/^\/+/, '');
  }

  if (existingUrl && typeof existingUrl === 'string' && existingUrl.trim()) {
    const relativePath = extractGitHubPagesRelativePath(existingUrl);
    if (relativePath) return relativePath.replace(/^\/+/, '');
  }

  if (existingPath && typeof existingPath === 'string' && existingPath.trim()) {
    return String(existingPath).trim().replace(/^\/+/, '');
  }

  const maxSegmentLength = 40;
  if (basename.length <= maxSegmentLength) {
    return `${baseId}-${filename}`;
  }

  const safeSegment = normalizeGitHubPagesPathSegment(rawName, 'archivo').slice(0, maxSegmentLength - 10);
  const timestampSuffix = `${Date.now()}`.slice(-8);
  return `${baseId}-${safeSegment}-${timestampSuffix}.html`;
}

function sanitizeStorageObjectName(value, fallback = 'file') {
  const input = String(value || '').trim();
  const extMatch = input.match(/\.[a-zA-Z0-9]{1,10}$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const base = input.replace(/\.[^.]+$/, '');
  const normalized = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const safeBase = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  const finalBase = safeBase || fallback;
  return `${finalBase}${ext}`;
}

function buildGitHubPagesFileUrl({ owner, repo, baseUrl, path, branch }) {
  const normalizedBaseUrl = String(baseUrl || '').trim();
  const normalizedPath = String(path || '').trim();
  const normalizedOwner = String(owner || '').trim();
  const normalizedRepo = String(repo || '').trim();

  if (normalizedBaseUrl) {
    return `${normalizedBaseUrl.replace(/\/$/, '')}/${normalizedPath.replace(/^\/+/, '')}`;
  }

  if (normalizedOwner && normalizedRepo) {
    const isUserPage = normalizedRepo.toLowerCase() === `${normalizedOwner.toLowerCase()}.github.io`;
    if (isUserPage) {
      return `https://${normalizedOwner}.github.io/${normalizedPath.replace(/^\/+/, '')}`;
    }
    return `https://${normalizedOwner}.github.io/${normalizedRepo}/${normalizedPath.replace(/^\/+/, '')}`;
  }

  return null;
}

module.exports = {
  buildGitHubPagesFilePath,
  buildGitHubPagesFileUrl,
  extractGitHubPagesRelativePath,
  buildStorageHtmlPath,
};