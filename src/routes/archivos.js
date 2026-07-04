const express = require('express');
const { supabaseDB } = require('../supabaseClient');
const { sanitizeUrl } = require('../utils/security');
const { buildGitHubPagesFileUrl } = require('../utils/githubPages');
const router = express.Router();

router.get('/archivos/:slug/:id', async (req, res) => {
  const { slug, id } = req.params;
  try {
    const { data, error } = await supabaseDB.from('html_files').select('*').eq('id', id).limit(1);
    if (!error && data && data.length > 0) {
      const record = data[0];
      const safeFileUrl = sanitizeUrl(record.file_url);
      if (safeFileUrl) return res.redirect(safeFileUrl);
      const safeHtmlUrl = sanitizeUrl(record.html_url);
      if (safeHtmlUrl) return res.redirect(safeHtmlUrl);
      const GHP_BASE_URL = process.env.GHPAGES_BASE_URL;
      const GHP_OWNER = process.env.GHPAGES_OWNER;
      const GHP_REPO = process.env.GHPAGES_REPO;
      const recordPath = buildGitHubPagesFilePath({
        id: record.id || id,
        name: record.name || record.filename || slug,
        preferredFilename: `${slug}.html`,
      });
      const possible = buildGitHubPagesFileUrl({
        owner: GHP_OWNER,
        repo: GHP_REPO,
        baseUrl: GHP_BASE_URL,
        path: recordPath,
      });
      const safePossible = sanitizeUrl(possible);
      if (safePossible) return res.redirect(safePossible);
      return res.status(404).send('<h1>Archivo no encontrado</h1>');
    }
  } catch (e) {
    console.warn('DB lookup error:', e.message || e);
  }
  // fallback to GH pages if configured
  const GHP_BASE_URL = process.env.GHPAGES_BASE_URL;
  const GHP_OWNER = process.env.GHPAGES_OWNER;
  const GHP_REPO = process.env.GHPAGES_REPO;
  const possible = buildGitHubPagesFileUrl({
    owner: GHP_OWNER,
    repo: GHP_REPO,
    baseUrl: GHP_BASE_URL,
    path: `files/${id}_${slug}.html`,
  });
  const safePossible = sanitizeUrl(possible);
  if (safePossible) return res.redirect(safePossible);
  return res.status(404).send('<h1>Archivo no encontrado</h1>');
});

module.exports = router;
