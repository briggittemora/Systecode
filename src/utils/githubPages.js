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
  buildGitHubPagesFileUrl,
};
