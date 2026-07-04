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
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const index = pathname.toLowerCase().indexOf('files/');
    if (index === -1) return null;
    return pathname.slice(index);
  } catch {
    return null;
  }
}

function buildGitHubPagesFilePath({ id, name, preferredFilename }) {
  const baseId = String(id || '').trim() || `${Date.now()}`;
  const rawName = String(preferredFilename || name || '').trim();
  const filename = normalizeGitHubPagesFilename(rawName, `${baseId}.html`);
  const basename = filename.replace(/\.html$/i, '');
  const maxSegmentLength = 40;
  if (basename.length <= maxSegmentLength) {
    return `files/${baseId}_${filename}`;
  }

  const safeSegment = normalizeGitHubPagesPathSegment(rawName, 'file').slice(0, maxSegmentLength - 10);
  const timestamp = `${Date.now()}`.slice(-8);
  return `files/${baseId}_${safeSegment}-${timestamp}.html`;
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
};
