const express = require('express');
const { supabaseDB } = require('../supabaseClient');
const router = express.Router();

router.get('/archivos/:slug/:id', async (req, res) => {
  const { slug, id } = req.params;
  try {
    const { data, error } = await supabaseDB.from('html_files').select('*').eq('id', id).limit(1);
    if (!error && data && data.length > 0) {
      const record = data[0];
      if (record.file_url) return res.redirect(record.file_url);
      if (record.html_url) return res.redirect(record.html_url);
    }
  } catch (e) {
    console.warn('DB lookup error:', e.message || e);
  }
  // fallback to GH pages if configured
  const GHP_BASE_URL = process.env.GHPAGES_BASE_URL;
  if (GHP_BASE_URL) {
    const possible = `${GHP_BASE_URL}/files/${id}_${slug}.html`;
    return res.redirect(possible);
  }
  return res.status(404).send('<h1>Archivo no encontrado</h1>');
});

module.exports = router;
