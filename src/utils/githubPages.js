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
    const filesIndex = segments.findIndex((segment) => segment.toLowerCase() === 'files');
    if (filesIndex === -1) return null;
    return segments.slice(filesIndex).join('/');
  } catch {
    return null;
  }
}

function extractGitHubPagesPathId(path) {
  if (!path || typeof path !== 'string') return null;
  const normalized = String(path).trim().replace(/^\/+/, '');
  const match = normalized.match(/(?:^|\/)files\/(\d+)_/i);
  return match ? match[1] : null;
}

function buildStorageHtmlPath({ id, originalName, existingPath }) {
  const baseId = String(id || '').trim();
  const safeName = sanitizeStorageObjectName(originalName, 'file.html');
  if (existingPath && typeof existingPath === 'string' && existingPath.trim()) {
    const trimmed = existingPath.trim();
    if (trimmed.startsWith('html/')) return trimmed;
    if (trimmed.startsWith('/html/')) return trimmed.replace(/^\/+/, '');
  }
  if (baseId) return `html/${baseId}_${safeName}`;
  return `html/${safeName}`;
}

function buildGitHubPagesFilePath({ id, name, preferredFilename, existingUrl, existingPath }) {
  const baseId = String(id || '').trim() || `${Date.now()}`;
  const rawName = String(preferredFilename || name || '').trim();
  const filename = normalizeGitHubPagesFilename(rawName, `${baseId}.html`);
  const basename = filename.replace(/\.html$/i, '');

  if (existingUrl && typeof existingUrl === 'string' && existingUrl.trim()) {
    const relativePath = extractGitHubPagesRelativePath(existingUrl);
    if (relativePath) {
      const normalized = String(relativePath).trim().replace(/^\/+/, '');
      if (normalized.toLowerCase().startsWith('files/')) return normalized;
      return `files/${normalized.replace(/^files\//i, '')}`;
    }
  }

  if (existingPath && typeof existingPath === 'string' && existingPath.trim()) {
    const normalized = String(existingPath).trim().replace(/^\/+/, '');
    if (normalized.toLowerCase().startsWith('files/')) return normalized;
    return `files/${normalized.replace(/^files\//i, '')}`;
  }

  const maxSegmentLength = 40;
  if (basename.length <= maxSegmentLength) {
    return `files/${baseId}_${filename}`;
  }

  const safeSegment = normalizeGitHubPagesPathSegment(rawName, 'file').slice(0, maxSegmentLength - 10);
  const timestamp = `${Date.now()}`.slice(-8);
  return `files/${baseId}_${safeSegment}-${timestamp}.html`;
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
