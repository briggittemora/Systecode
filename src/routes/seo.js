const express = require('express');
const path = require('path');
const fs = require('fs');
const { supabaseDB } = require('../supabaseClient');

const router = express.Router();

// robots.txt
router.get('/robots.txt', (req, res) => {
  const host = req.get('host') || 'codigossyste.onrender.com';
  const sitemapUrl = `https://${host}/sitemap.xml`;
  const lines = [
    'User-agent: *',
    'Disallow:',
    `Sitemap: ${sitemapUrl}`,
  ];
  res.type('text/plain').send(lines.join('\n'));
});

// sitemap.xml (simple dynamic sitemap from DB)
router.get('/sitemap.xml', async (req, res) => {
  try {
    const base = req.protocol + '://' + (req.get('host') || 'codigossyste.onrender.com');
    // Query public files (limit to 20000)
    const { data, error } = await supabaseDB
      .from('files')
      .select('id, slug, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20000);

    if (error) {
      console.warn('[sitemap] supabase error', error.message || error);
    }

    const urls = [];
    // add homepage
    urls.push({ loc: base + '/', priority: '1.0' });

    if (Array.isArray(data)) {
      for (const row of data) {
        try {
          const id = String(row.id);
          const slug = String(row.slug || '').replace(/\s+/g, '-');
          const loc = `${base}/archivos/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
          const lastmod = row.updated_at ? new Date(row.updated_at).toISOString() : null;
          urls.push({ loc, lastmod, priority: '0.6' });
        } catch (e) {}
      }
    }

    const xmlParts = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];

    for (const u of urls) {
      xmlParts.push('  <url>');
      xmlParts.push(`    <loc>${u.loc}</loc>`);
      if (u.lastmod) xmlParts.push(`    <lastmod>${u.lastmod}</lastmod>`);
      if (u.priority) xmlParts.push(`    <priority>${u.priority}</priority>`);
      xmlParts.push('  </url>');
    }

    xmlParts.push('</urlset>');
    res.type('application/xml').send(xmlParts.join('\n'));
  } catch (e) {
    console.error('[sitemap] exception', e?.message || e);
    res.status(500).send('');
  }
});

// Prerender simple file detail for SEO
router.get('/archivos/:slug/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const cleanedId = String(id).replace(/[^0-9a-zA-Z-_]/g, '');
    // fetch file record
    const { data, error } = await supabaseDB.from('files').select('*').eq('id', cleanedId).limit(1).single();
    let title = 'Plantillas HTML - SysteCode';
    let description = 'Descubre plantillas HTML gratuitas y premium en SysteCode.';
    let image = `${req.protocol}://${req.get('host')}/Systecode.png`;
    if (!error && data) {
      title = data.name ? `${String(data.name).trim()} | SysteCode` : title;
      description = data.description ? String(data.description).trim().slice(0, 200) : description;
      if (data.preview_url) image = data.preview_url;
    }

    // try to read SPA index.html from likely dist locations (backend/dist, root dist, frontend/dist)
    const candidateIndexPaths = [
      path.resolve(__dirname, '..', 'dist', 'index.html'), // backend/dist
      path.resolve(__dirname, '..', '..', 'dist', 'index.html'), // root dist
      path.resolve(__dirname, '..', '..', 'frontend', 'dist', 'index.html'), // frontend/dist
    ];

    let html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${escapeHtml(image)}"><link rel="canonical" href="${req.protocol}://${req.get('host')}${req.originalUrl}"></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></body></html>`;
    try {
      let found = null;
      for (const p of candidateIndexPaths) {
        if (fs.existsSync(p)) {
          found = p;
          break;
        }
      }
      if (found) {
        html = fs.readFileSync(found, 'utf8');
        // inject/replace simple tags
        html = html.replace(/<title>.*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
        html = html.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${escapeHtml(description)}" />`);
        // add og tags if not present
        if (!/property="og:title"/i.test(html)) html = html.replace('</head>', `<meta property="og:title" content="${escapeHtml(title)}" />\n<meta property="og:description" content="${escapeHtml(description)}" />\n<meta property="og:image" content="${escapeHtml(image)}" />\n</head>`);
      } else {
        console.warn('[seo] no frontend index.html found in candidate paths, returning minimal SEO HTML');
      }
    } catch (e) {
      console.warn('[seo] failed to read frontend index:', e?.message || e);
    }

    res.type('text/html').send(html);
  } catch (e) {
    console.error('[seo] error', e?.message || e);
    return next();
  }
});

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = router;
