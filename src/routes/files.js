const express = require('express');
const multer = require('multer');
const { supabaseDB, supabaseStorage, SUPABASE_STORAGE_BUCKET } = require('../supabaseClient');
const { getSupabaseUserFromRequest, getUserRowByEmail } = require('../utils/supabaseAuth');
const cloudinary = require('cloudinary').v2;
const { Octokit } = require('@octokit/rest');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const { Readable, pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

const getVipFilePriceUsd = (rec) => {
  const p = rec?.price_usd !== null && typeof rec?.price_usd !== 'undefined' ? Number(rec.price_usd) : null;
  if (Number.isFinite(p) && p > 0) return p;

  const rawEpago = rec?.epago !== null && typeof rec?.epago !== 'undefined' ? String(rec.epago).trim().toLowerCase() : null;
  if (rawEpago === 'vip') return 2;
  if (rawEpago !== null && rawEpago !== '' && !isNaN(Number(rawEpago))) {
    const n = Number(rawEpago);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const tipoRaw = String(rec?.tipo || rec?.type || '').toLowerCase();
  if (tipoRaw === 'vip') return 2;

  return null;
};

const isVipFileRecord = (rec) => {
  const tipoRaw = String(rec?.tipo || rec?.type || '').toLowerCase();
  const p = getVipFilePriceUsd(rec);
  return tipoRaw === 'vip' || (Number.isFinite(p) && p > 0) || String(rec?.epago || '').trim().toLowerCase() === 'vip';
};

const customIdForFile = (fileId) => `vip-file-${String(fileId)}`;

// GET /api/files
router.get('/files', async (req, res) => {
  try {
    const { search, type, category, limit = 50, offset = 0 } = req.query;
    let query = supabaseDB.from('html_files').select('*').order('created_at', { ascending: false });
    // Search against filename and descripcion columns
    if (search) {
      const s = search.replace(/%/g, '\\%');
      query = query.or(`filename.ilike.%${s}%,descripcion.ilike.%${s}%`);
    }
    // Filter using actual DB column names: 'tipo' and 'categoria'
    if (type) query = query.eq('tipo', type);
    if (category) {
      // allow flexible category filtering: exact match or case-insensitive partial match
      const c = String(category).trim();
      if (c.length > 0) {
        query = query.ilike('categoria', `%${c}%`);
      }
    }
    const start = parseInt(offset, 10) || 0;
    const lim = Math.min(parseInt(limit, 10) || 50, 1000);
    const { data, error } = await query.range(start, start + lim - 1);
    if (error) {
      console.warn('Supabase list error:', error.message || error);
      const msg = (error && error.message) || String(error || 'Error fetching files');
      if (msg.toLowerCase().includes('exceed') || msg.toLowerCase().includes('restricted')) {
        return res.status(503).json({ error: 'Service temporarily unavailable (Supabase quota or restriction). Contact support or check your Supabase project.' });
      }
      return res.status(500).json({ error: msg });
    }
    // build likes count map for these files
    const ids = (data || []).map((r) => r.id).filter(Boolean);
    let likesCountMap = {};
    if (ids.length > 0) {
      const { data: likesRows, error: likesErr } = await supabaseDB.from('file_likes').select('file_id').in('file_id', ids);
      if (!likesErr && Array.isArray(likesRows)) {
        for (const lr of likesRows) likesCountMap[lr.file_id] = (likesCountMap[lr.file_id] || 0) + 1;
      }
    }

    // build uploader map for these files (html_files.user_id -> users.*)
    const userIds = Array.from(new Set((data || []).map((r) => r.user_id).filter(Boolean)));
    let uploaderMap = {};
    if (userIds.length > 0) {
      try {
        const { data: urows, error: uerr } = await supabaseDB
          .from('users')
          .select('id, email, name, rol')
          .in('id', userIds);
        if (!uerr && Array.isArray(urows)) {
          for (const u of urows) {
            const displayName = u.name || null;
            uploaderMap[u.id] = {
              id: u.id,
              email: u.email || null,
              name: displayName,
              role: u.rol || null,
            };
          }
        }
      } catch (e) {
        // ignore uploader failures
      }
    }

    // Map DB columns to frontend expected fields
    const mapped = (data || []).map((rec) => {
      const filename = rec.name || rec.filename || rec.file_url || '';
      const rawName = rec.name || rec.filename || rec.file_data || '';
      const slug = (rawName && rawName.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || `file-${rec.id}`;
      const preview_url = rec.preview_image_url || rec.preview_url || rec.preview_video_url || rec.preview || rec.supabase_url || null;
      const html_url = rec.file_url || rec.supabase_url || rec.html_url || null;
      const rawEpago = (rec && typeof rec.epago !== 'undefined' && rec.epago !== null) ? String(rec.epago).trim().toLowerCase() : null;
      const explicitFree = rawEpago === 'gratuito' || rawEpago === 'gratis' || rawEpago === 'free';
      const priceUsd = getVipFilePriceUsd(rec);
      const isVip = !explicitFree && isVipFileRecord(rec);
      const price = Number.isFinite(priceUsd) ? priceUsd : null;
      return {
        id: rec.id,
        name: rawName || filename || `Archivo ${rec.id}`,
        slug,
        type: isVip ? 'vip' : 'free',
        category: rec.categoria || rec.category || null,
        price,
        description: rec.descripcion || rec.description || null,
        preview_url,
        preview_image_url: rec.preview_image_url || null,
        preview_video_url: rec.preview_video_url || null,
        html_url,
        is_video: !!rec.preview_video_url,
        created_at: rec.created_at,
        downloads: rec.downloads || 0,
        likes: likesCountMap[rec.id] || 0,
        raw: rec,
        uploader: (rec.user_id && uploaderMap[rec.user_id]) ? uploaderMap[rec.user_id] : null,
      };
    });

    return res.json({ data: mapped });
  } catch (e) {
    console.error('[PUT /api/file/:id] error:', e && (e.stack || e.message || e));
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const msg = (e && (e.message || String(e))) || 'Internal server error';
    if (!isProd) {
      return res.status(500).json({ error: msg, stack: e && e.stack ? e.stack.split('\n').slice(0,10).join('\n') : null });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/file/:id -> devuelve un solo archivo mapeado (usado por frontend para redirección)
const tryFindFileByIdOrSlug = async (identifier) => {
  // identifier may be numeric id (32-bit), slug, or other token. Try safe numeric lookup first.
  try {
    if (/^\d+$/.test(String(identifier))) {
      const num = Number(identifier);
      if (Number.isFinite(num) && num <= 2147483647) {
        const { data, error } = await supabaseDB.from('html_files').select('*').eq('id', num).limit(1);
        if (!error && data && data.length) return data[0];
      }
    }
  } catch (e) {
    console.warn('Numeric id lookup failed:', e && e.message ? e.message : e);
  }

  // try slug
  // try filename fuzzy match (handle slugs like "my-file-name" by also checking with spaces)
  try {
    const candidates = [identifier, String(identifier).replace(/-/g, ' ')];
    for (const c of candidates) {
      if (!c) continue;
      try {
        const { data: fdata, error: fErr } = await supabaseDB.from('html_files').select('*').ilike('filename', `%${c}%`).limit(1);
        if (!fErr && fdata && fdata.length) return fdata[0];
      } catch (e) {}
    }
  } catch (e) {}

  // try matching against common URL/path columns
  try {
    const { data: udata, error: uErr } = await supabaseDB.from('html_files').select('*').or(`file_url.eq.${identifier},supabase_url.eq.${identifier},file_data.eq.${identifier}`).limit(1);
    if (!uErr && udata && udata.length) return udata[0];
  } catch (e) {}

  return null;
};

router.get('/file/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rec = await tryFindFileByIdOrSlug(id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    const filename = rec.name || rec.filename || rec.file_url || '';
    const rawName = rec.name || rec.filename || rec.file_data || '';
    const slug = (rawName && rawName.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || `file-${rec.id}`;
    const preview_url = rec.preview_image_url || rec.preview_url || rec.preview_video_url || rec.preview || rec.supabase_url || null;
    const html_url = rec.file_url || rec.supabase_url || rec.html_url || null;
    const rawEpago2 = (rec && typeof rec.epago !== 'undefined' && rec.epago !== null) ? String(rec.epago).trim().toLowerCase() : null;
    const explicitFree2 = rawEpago2 === 'gratuito' || rawEpago2 === 'gratis' || rawEpago2 === 'free';
    const priceUsd2 = getVipFilePriceUsd(rec);
    const isVip = !explicitFree2 && isVipFileRecord(rec);
    const price = Number.isFinite(priceUsd2) ? priceUsd2 : null;
    const mapped = {
      id: rec.id,
      name: rawName || filename || `Archivo ${rec.id}`,
      slug,
      type: isVip ? 'vip' : 'free',
      category: rec.categoria || rec.category || null,
      price,
      description: rec.descripcion || rec.description || null,
      preview_url,
      preview_image_url: rec.preview_image_url || null,
      preview_video_url: rec.preview_video_url || null,
      html_url,
      is_video: !!rec.preview_video_url,
      created_at: rec.created_at,
      downloads: rec.downloads || 0,
      likes: 0,
      raw: rec,
      uploader: null,
    };
    // fallback single-file likes
    try {
      const { data: likeRows, error: likeErr } = await supabaseDB.from('file_likes').select('file_id').eq('file_id', rec.id);
      if (!likeErr && Array.isArray(likeRows)) mapped.likes = likeRows.length;
    } catch (e) {}
    // include uploader info if available
    try {
      if (rec.user_id) {
        const { data: urows, error: uerr } = await supabaseDB
          .from('users')
          .select('id, email, name, rol')
          .eq('id', rec.user_id)
          .limit(1);
        if (!uerr && urows && urows.length) {
          const u = urows[0];
          mapped.uploader = {
            id: u.id,
            email: u.email || null,
            name: u.name || null,
            role: u.rol || null,
          };
        }
      }
    } catch (e) {
      // ignore
    }
    return res.json({ data: mapped });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/file/:id -> update metadata (only owner or admin)
router.put('/file/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user, token, error } = await require('../utils/supabaseAuth').getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'No autorizado' });

    const rec = await tryFindFileByIdOrSlug(id);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    // fetch user row to get role
    const { row: dbUser } = await require('../utils/supabaseAuth').getUserRowByEmail(user.email);
    const role = String(dbUser?.rol || '').toLowerCase();

    const isOwner = rec.user_id && user.id && String(rec.user_id) === String(user.id);
    if (!isOwner && role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const allowed = {};
    const { name, description, category, tipo, epago, preview_url, preview_image_url, preview_video_url } = req.body || {};

    // Only admin can set/modify VIP-related fields (tipo/epago).
    // This prevents non-admins from turning a free file into VIP via edit.
    if ((typeof tipo !== 'undefined') || (typeof epago !== 'undefined')) {
      const tipoReq = typeof tipo !== 'undefined' ? String(tipo).toLowerCase() : String(rec.tipo || '').toLowerCase();
      const epagoReq = typeof epago !== 'undefined' ? epago : rec.epago;
      const epagoStr = (epagoReq === null || typeof epagoReq === 'undefined') ? '' : String(epagoReq).trim().toLowerCase();
      const epagoNum = (!epagoStr || isNaN(Number(epagoStr))) ? null : Number(epagoStr);
      const wantsVip = (tipoReq === 'vip') || (epagoStr === 'vip') || (epagoNum !== null && epagoNum > 0);
      if (wantsVip && role !== 'admin') return res.status(403).json({ error: 'Solo un admin puede marcar un archivo como VIP.' });
    }

    // Validate video preview URL: only VIP files (or admin) can set a preview video URL
    const rawEpago = (rec && typeof rec.epago !== 'undefined' && rec.epago !== null) ? String(rec.epago).trim().toLowerCase() : '';
    const epagoNumExisting = rawEpago && !isNaN(Number(rawEpago)) ? Number(rawEpago) : null;
    const isVipFile = String(rec.tipo || '').toLowerCase() === 'vip' || rawEpago === 'vip' || (epagoNumExisting !== null && epagoNumExisting > 0);
    if (typeof preview_video_url !== 'undefined' && preview_video_url !== null && preview_video_url !== '') {
      if (!isVipFile && role !== 'admin') {
        return res.status(403).json({ error: 'Solo archivos VIP (o admin) pueden tener preview en video.' });
      }
    }

    if (typeof name !== 'undefined') allowed.filename = name;
    if (typeof description !== 'undefined') allowed.descripcion = description;
    if (typeof category !== 'undefined') allowed.categoria = category;
    if (typeof tipo !== 'undefined') allowed.tipo = tipo;
    if (typeof epago !== 'undefined') allowed.epago = epago;

    // Allow setting preview URLs directly from the edit form
    // Note: there is no `preview` DB column; map `preview_url` to image or video columns.
    if (typeof preview_image_url !== 'undefined') {
      allowed.preview_image_url = preview_image_url || null;
    }
    if (typeof preview_video_url !== 'undefined') {
      allowed.preview_video_url = preview_video_url || null;
    }
    if (typeof preview_url !== 'undefined' && (typeof preview_image_url === 'undefined' && typeof preview_video_url === 'undefined')) {
      // Guess type by file extension in the URL (basic heuristic)
      const urlLower = String(preview_url || '').toLowerCase();
      if (urlLower.match(/\.(mp4|webm|mov|ogg|m4v|avi)(\?|$)/)) {
        allowed.preview_video_url = preview_url || null;
      } else {
        allowed.preview_image_url = preview_url || null;
      }
    }

    const { data: up, error: upErr } = await supabaseDB.from('html_files').update(allowed).eq('id', rec.id).select();
    if (upErr) return res.status(500).json({ error: upErr.message || String(upErr) });
    return res.json({ success: true, data: up && up[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/file/:id/assets -> update preview image/video and/or replace HTML file
router.post(
  '/file/:id/assets',
  upload.fields([
    { name: 'previewImage', maxCount: 1 },
    { name: 'previewVideo', maxCount: 1 },
    { name: 'htmlFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { user } = await require('../utils/supabaseAuth').getSupabaseUserFromRequest(req);
      if (!user) return res.status(401).json({ error: 'No autorizado' });

      const rec = await tryFindFileByIdOrSlug(id);
      if (!rec) return res.status(404).json({ error: 'Not found' });

      const { row: dbUser } = await require('../utils/supabaseAuth').getUserRowByEmail(user.email);
      const role = String(dbUser?.rol || '').toLowerCase();
      const isOwner = rec.user_id && user.id && String(rec.user_id) === String(user.id);
      if (!isOwner && role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

      const rawEpago = (rec && typeof rec.epago !== 'undefined' && rec.epago !== null) ? String(rec.epago).trim().toLowerCase() : '';
      const epagoNum = rawEpago && !isNaN(Number(rawEpago)) ? Number(rawEpago) : null;
      const isVipFile = String(rec.tipo || '').toLowerCase() === 'vip' || rawEpago === 'vip' || (epagoNum !== null && epagoNum > 0);

      const previewImageFile = req.files && req.files.previewImage && req.files.previewImage[0];
      const previewVideoFile = req.files && req.files.previewVideo && req.files.previewVideo[0];
      const htmlFile = req.files && req.files.htmlFile && req.files.htmlFile[0];

      if (!previewImageFile && !previewVideoFile && !htmlFile) {
        return res.status(400).json({ error: 'No files provided' });
      }

      // Rule: only VIP files (or admin) can set a preview video
      if (previewVideoFile && !isVipFile && role !== 'admin') {
        return res.status(403).json({ error: 'Solo archivos VIP (o admin) pueden tener preview en video.' });
      }

      const uploadToBucket = async (path, buffer, mime) => {
        let upRes = await supabaseStorage.storage.from(SUPABASE_STORAGE_BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
        if (upRes.error) throw upRes.error;
        const pub = supabaseStorage.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
        const publicUrl = (pub && pub.data && (pub.data.publicUrl || pub.data.publicURL)) || (pub && (pub.publicURL || pub.publicUrl)) || null;
        if (publicUrl) return publicUrl;
        const storageBase = process.env.SUPABASE_STORAGE_URL || process.env.SUPABASE_URL || '';
        if (storageBase) {
          return `${storageBase.replace(/\/$/, '')}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${encodeURIComponent(path)}`;
        }
        return null;
      };

      const uploadToCloudinary = async (folder, buffer, originalName, resourceType = 'image') => {
        return new Promise((resolve, reject) => {
          // public_id: filename without extension, sanitized
          const baseName = String(originalName || '').replace(/\.[^.]+$/, '');
          const publicId = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
          const opts = { folder, resource_type: resourceType, public_id: publicId, overwrite: true };
          const stream = cloudinary.uploader.upload_stream(
            opts,
            (err, result) => {
              if (err) return reject(err);
              resolve(result && result.secure_url ? result.secure_url : (result && result.url ? result.url : null));
            }
          );
          stream.end(buffer);
        });
      };

      const updates = {};
      const now = Date.now();

      if (previewImageFile) {
        try {
          const publicUrl = await uploadToCloudinary(`previews`, previewImageFile.buffer, `${rec.id}_${now}_${previewImageFile.originalname}`, 'image');
          updates.preview_image_url = publicUrl;
        } catch (e) {
          console.warn('Cloudinary preview image upload failed:', e?.message || e);
          return res.status(500).json({ error: 'No se pudo subir la imagen de preview' });
        }
      }

      if (previewVideoFile) {
        try {
          const publicUrl = await uploadToCloudinary(`previews`, previewVideoFile.buffer, `${rec.id}_${now}_${previewVideoFile.originalname}`, 'video');
          updates.preview_video_url = publicUrl;
        } catch (e) {
          console.warn('Cloudinary preview video upload failed:', e?.message || e);
          return res.status(500).json({ error: 'No se pudo subir el video de preview' });
        }
      }

      if (htmlFile) {
        const path = `html/${rec.id}_${now}_${htmlFile.originalname}`;
        const publicUrl = await uploadToBucket(path, htmlFile.buffer, htmlFile.mimetype);
        updates.file_data = path;
        updates.supabase_url = publicUrl;
      }

      const { data: up, error: upErr } = await supabaseDB.from('html_files').update(updates).eq('id', rec.id).select();
      if (upErr) return res.status(500).json({ error: upErr.message || String(upErr) });
      return res.json({ success: true, data: up && up[0] });
    } catch (e) {
      console.error('Assets endpoint error:', e && e.stack ? e.stack : e);
      const msg = (e && (e.message || e.toString())) || 'Internal server error';
      return res.status(500).json({ error: msg });
    }
  }
);

// POST /api/file/:id/publish -> commit HTML to GitHub Pages branch and return public URL
router.post('/file/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const { html } = req.body || {};
    if (!html) return res.status(400).json({ error: 'Missing html in body' });

    const { user } = await require('../utils/supabaseAuth').getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'No autorizado' });

    const rec = await tryFindFileByIdOrSlug(id);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    const { row: dbUser } = await require('../utils/supabaseAuth').getUserRowByEmail(user.email);
    const role = String(dbUser?.rol || '').toLowerCase();
    const isOwner = rec.user_id && user.id && String(rec.user_id) === String(user.id);
    if (!isOwner && role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    // Support both legacy GITHUB_* names and existing GHPAGES_* names in .env
    const GH_OWNER = process.env.GHPAGES_OWNER || process.env.GITHUB_PAGES_REPO_OWNER || process.env.GH_PAGES_OWNER;
    const GH_REPO = process.env.GHPAGES_REPO || process.env.GITHUB_PAGES_REPO_NAME || process.env.GH_PAGES_REPO;
    const GH_TOKEN = process.env.GHPAGES_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PAGES_TOKEN || process.env.GH_PAGES_TOKEN;
    if (!GH_OWNER || !GH_REPO || !GH_TOKEN) return res.status(500).json({ error: 'GitHub Pages not configured on server' });

    const octokit = new Octokit({ auth: GH_TOKEN });

    // target branch for pages (support GHPAGES_BRANCH or GITHUB_PAGES_BRANCH)
    const branch = process.env.GHPAGES_BRANCH || process.env.GITHUB_PAGES_BRANCH || 'gh-pages';
    const filenameSafe = String(rec.name || rec.filename || `file-${rec.id}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const path = `${String(rec.id)}-${filenameSafe}.html`;

    // ensure branch exists; if not, create from default branch
    let branchSha = null;
    try {
      const ref = await octokit.rest.git.getRef({ owner: GH_OWNER, repo: GH_REPO, ref: `heads/${branch}` });
      branchSha = ref.data.object.sha;
    } catch (e) {
      // create branch from default
      const repoInfo = await octokit.rest.repos.get({ owner: GH_OWNER, repo: GH_REPO });
      const defaultBranch = repoInfo.data.default_branch;
      const commit = await octokit.rest.repos.getCommit({ owner: GH_OWNER, repo: GH_REPO, ref: defaultBranch });
      const baseSha = commit.data.sha;
      await octokit.rest.git.createRef({ owner: GH_OWNER, repo: GH_REPO, ref: `refs/heads/${branch}`, sha: baseSha });
      branchSha = baseSha;
    }

    // prepare content
    const contentB64 = Buffer.from(html, 'utf8').toString('base64');

    // try to get existing file to use sha for update
    let existingSha = null;
    try {
      const getRes = await octokit.rest.repos.getContent({ owner: GH_OWNER, repo: GH_REPO, path, ref: branch });
      if (getRes && getRes.data && getRes.data.sha) existingSha = getRes.data.sha;
    } catch (e) {
      // not found -> create
    }

    const msg = `Publish file ${rec.id} via app`;
    if (existingSha) {
      await octokit.rest.repos.createOrUpdateFileContents({ owner: GH_OWNER, repo: GH_REPO, path, message: msg, content: contentB64, branch, sha: existingSha });
    } else {
      await octokit.rest.repos.createOrUpdateFileContents({ owner: GH_OWNER, repo: GH_REPO, path, message: msg, content: contentB64, branch });
    }

    // construct public URL. Prefer explicit base if provided (GHPAGES_BASE_URL)
    let publicUrl = null;
    const baseUrl = (process.env.GHPAGES_BASE_URL || process.env.GITHUB_PAGES_BASE_URL || '').toString().trim();
    if (baseUrl) {
      publicUrl = `${baseUrl.replace(/\/$/, '')}/${path}`;
    } else {
      // If repo is owner.github.io then path served at /<path>
      if (`${GH_REPO}`.toLowerCase() === `${GH_OWNER.toLowerCase()}.github.io`) {
        publicUrl = `https://${GH_OWNER}.github.io/${path}`;
      } else {
        publicUrl = `https://${GH_OWNER}.github.io/${GH_REPO}/${path}`;
      }
    }

    return res.json({ data: { url: publicUrl } });
  } catch (e) {
    console.error('Publish endpoint error:', e);
    return res.status(500).json({ error: (e && e.message) || 'Publish failed' });
  }
});

// POST /api/file/:id/upload-audio-github -> upload an mp3 to the configured GitHub repo and return raw URL
router.post('/file/:id/upload-audio-github', upload.single('audioFile'), async (req, res) => {
  try {
    const { id } = req.params;
    const audioFile = req.file;
    if (!audioFile) return res.status(400).json({ error: 'missing_file' });

    // require GitHub config similar to publish endpoint
    const GH_OWNER = process.env.GHPAGES_OWNER || process.env.GITHUB_PAGES_REPO_OWNER || process.env.GH_PAGES_OWNER;
    const GH_REPO = process.env.GHPAGES_REPO || process.env.GITHUB_PAGES_REPO_NAME || process.env.GH_PAGES_REPO;
    const GH_TOKEN = process.env.GHPAGES_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PAGES_TOKEN || process.env.GH_PAGES_TOKEN;
    if (!GH_OWNER || !GH_REPO || !GH_TOKEN) return res.status(500).json({ error: 'GitHub not configured on server' });

    const { Octokit } = require('@octokit/rest');
    const octokit = new Octokit({ auth: GH_TOKEN });

    const branch = process.env.GHPAGES_BRANCH || process.env.GITHUB_PAGES_BRANCH || 'gh-pages';
    const safeName = String(audioFile.originalname || `audio-${id}.mp3`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `assets/audio/${String(id)}_${Date.now()}_${safeName}`;

    // prepare base64
    const contentB64 = Buffer.from(audioFile.buffer).toString('base64');

    // try to get existing file to retrieve sha (unlikely) — ignore errors
    let existingSha = null;
    try {
      const getRes = await octokit.rest.repos.getContent({ owner: GH_OWNER, repo: GH_REPO, path, ref: branch });
      if (getRes && getRes.data && getRes.data.sha) existingSha = getRes.data.sha;
    } catch (e) {
      // ignore — create new file
    }

    const msg = `Upload audio for file ${id}`;
    if (existingSha) {
      await octokit.rest.repos.createOrUpdateFileContents({ owner: GH_OWNER, repo: GH_REPO, path, message: msg, content: contentB64, branch, sha: existingSha });
    } else {
      await octokit.rest.repos.createOrUpdateFileContents({ owner: GH_OWNER, repo: GH_REPO, path, message: msg, content: contentB64, branch });
    }

    // construct raw URL
    const rawUrl = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${branch}/${path}`;

    return res.json({ ok: true, data: { rawUrl } });
  } catch (e) {
    console.error('POST /api/file/:id/upload-audio-github error:', e && (e.stack || e.message || e));
    return res.status(500).json({ error: 'upload_failed' });
  }
});

// DELETE /api/file/:id -> delete file (only owner or admin)
router.delete('/file/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[DELETE /api/file/:id] requested id=', id);
    const { user } = await require('../utils/supabaseAuth').getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'No autorizado' });

    const rec = await tryFindFileByIdOrSlug(id);
    if (!rec) {
      console.warn(`[DELETE /api/file/:id] record not found for id=${id}`);
      return res.status(404).json({ error: 'Not found' });
    }

    const { row: dbUser } = await require('../utils/supabaseAuth').getUserRowByEmail(user.email);
    const role = String(dbUser?.rol || '').toLowerCase();

    const isOwner = rec.user_id && user.id && String(rec.user_id) === String(user.id);
    if (!isOwner && role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    // delete DB record
    const { data: del, error: delErr } = await supabaseDB.from('html_files').delete().eq('id', rec.id).select();
    if (delErr) return res.status(500).json({ error: delErr.message || String(delErr) });

    // Attempt to remove associated storage objects (best-effort)
    try {
      const pathsToRemove = [];
      const bucket = SUPABASE_STORAGE_BUCKET;
      // If file_data stores the internal path (like html/<id>_name)
      if (rec.file_data && typeof rec.file_data === 'string') {
        // if it looks like a path (no http) use directly
        if (!/^https?:\/\//i.test(rec.file_data)) pathsToRemove.push(rec.file_data);
      }
      // If supabase_url or preview urls point to storage public path, extract path
      const tryExtract = (u) => {
        if (!u || typeof u !== 'string') return null;
        try {
          const url = new URL(u);
          // match /storage/v1/object/public/<bucket>/<path>
          const m = url.pathname.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
          if (m) return decodeURIComponent(m[2]);
        } catch (e) {}
        return null;
      };
      const maybe1 = tryExtract(rec.supabase_url || rec.html_url || rec.file_url);
      if (maybe1) pathsToRemove.push(maybe1);
      const maybe2 = tryExtract(rec.preview_image_url);
      if (maybe2) pathsToRemove.push(maybe2);
      const maybe3 = tryExtract(rec.preview_video_url);
      if (maybe3) pathsToRemove.push(maybe3);

      // Deduplicate and filter
      const uniq = Array.from(new Set(pathsToRemove)).filter(Boolean);
      if (uniq.length > 0) {
        try {
          const { data: remData, error: remErr } = await supabaseStorage.storage.from(bucket).remove(uniq);
          if (remErr) console.warn('Storage remove error:', remErr.message || remErr);
        } catch (e) {
          console.warn('Storage remove exception:', e?.message || e);
        }
      }
    } catch (e) {
      console.warn('Error cleaning storage objects:', e?.message || e);
    }

    return res.json({ success: true, data: del && del[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

// GET /api/file/:id/download -> increment downloads and stream file as attachment
// Simplified download: redirect for public files, generate signed URL for private Supabase objects
router.get('/file/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const rec = await tryFindFileByIdOrSlug(id);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    // VIP gating: require auth + membership or per-file purchase
    if (isVipFileRecord(rec)) {
      // Guest unlock token support
      const unlockToken = String(req.get('X-Unlock-Token') || req.query?.unlockToken || '').trim();
      let guestAuthorized = false;
      if (unlockToken) {
        try {
          const guestEmail = `guest:${unlockToken}`;
          const customId = customIdForFile(rec.id || id);
          const { data: grow, error: gerr } = await supabaseDB
            .from('paypal_orders')
            .select('order_id,status')
            .eq('email', guestEmail)
            .eq('custom_id', customId)
            .limit(1);
          if (!gerr) {
            guestAuthorized = Array.isArray(grow) && grow.length > 0 && String(grow[0].status || '').toUpperCase() === 'COMPLETED';
          }
        } catch (e) {
          guestAuthorized = false;
        }
      }

      if (!guestAuthorized) {
        const { user, error: authError } = await getSupabaseUserFromRequest(req);
        if (!user || authError) {
          return res.status(401).json({ error: 'No autorizado. Inicia sesión para descargar archivos VIP.' });
        }
        const email = user.email || null;
        if (!email) return res.status(401).json({ error: 'No autorizado' });

        const { row: dbUser } = await getUserRowByEmail(email);
        const modalidad = String(dbUser?.modalidad || '').toLowerCase();
        if (modalidad !== 'vip') {
          const customId = customIdForFile(rec.id || id);
          const { data: prow, error: perr } = await supabaseDB
            .from('paypal_orders')
            .select('order_id,status')
            .eq('email', email)
            .eq('custom_id', customId)
            .limit(1);
          if (perr) {
            console.warn('paypal_orders purchase check error:', perr.message || perr);
            return res.status(500).json({ error: 'No se pudo verificar el acceso VIP' });
          }
          const hasPurchase = Array.isArray(prow) && prow.length > 0 && String(prow[0].status || '').toUpperCase() === 'COMPLETED';
          if (!hasPurchase) {
            return res.status(403).json({ error: 'Acceso VIP requerido. Compra el archivo o adquiere la membresía.' });
          }
        }
      }
    }

    // increment downloads (best-effort)
    try {
      await supabaseDB.from('html_files').update({ downloads: (rec.downloads || 0) + 1 }).eq('id', id);
    } catch (e) {
      console.warn('Failed to update downloads count:', e && e.message ? e.message : e);
    }

    // prefer explicit file_url first, then supabase_url
    let url = rec.file_url || rec.supabase_url || rec.html_url || null;
    if (!url) return res.status(404).json({ error: 'File URL not found' });

    // Decide whether to stream (force download) or redirect.
    const looksLikeHtml = (u) => /\.html?(?:$|\?)/i.test(String(u || '')) || (rec.file_data && /\.html?$/i.test(rec.file_data));

    // Helper to stream a URL (fetch and pipe to response with Content-Disposition)
    const streamUrlAsAttachment = async (streamUrl) => {
      let fetchRes;
      try {
        fetchRes = await fetch(streamUrl);
      } catch (err) {
        console.error('Failed to fetch file for streaming:', err);
        return res.status(502).json({ error: 'Failed to fetch file from storage' });
      }
      if (!fetchRes.ok) {
        console.error('Fetch returned non-ok status for', streamUrl, fetchRes.status);
        return res.status(502).json({ error: 'Failed to fetch file from storage' });
      }

      const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
      const contentLength = fetchRes.headers.get('content-length');

      // determine filename
      let filename = `file-${id}`;
      try {
        const u = new URL(streamUrl);
        const p = u.pathname.split('/').pop() || filename;
        filename = decodeURIComponent(p);
      } catch (e) {
        if (rec.file_data) filename = rec.file_data.split('/').pop() || filename;
      }

      // If HTML, rewrite asset URLs to signed/absolute URLs so the downloaded file works offline
      if (/text\/html/i.test(contentType)) {
        try {
          const html = await fetchRes.text();

          // helper to generate signed URL for storage paths
          const genSigned = async (candidate) => {
            if (!candidate) return null;
            // ignore absolute urls
            if (/^https?:\/\//i.test(candidate) || /^data:/i.test(candidate) || candidate.startsWith('mailto:') || candidate.startsWith('#')) return candidate;

            // storage public path: /storage/v1/object/public/<bucket>/<path>
            const m = String(candidate).match(/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
            if (m) {
              const bucket = m[1];
              const objectPath = decodeURIComponent(m[2]);
              try {
                const { data: signed, error: signErr } = await supabaseStorage.storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
                if (!signErr && signed) return signed.signedUrl || signed.signedURL;
              } catch (e) { console.error('signed err', e); }
              return candidate;
            }

            // if candidate looks like preview-images/... or preview-videos/... or other bucket paths
            if (/^(preview-images|preview-videos|html-files)\//.test(candidate)) {
              const parts = candidate.split('/');
              const bucket = parts[0];
              const objectPath = parts.slice(1).join('/');
              try {
                const { data: signed, error: signErr } = await supabaseStorage.storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
                if (!signErr && signed) return signed.signedUrl || signed.signedURL;
              } catch (e) { console.error('signed err2', e); }
              return candidate;
            }

            // relative paths: try resolving against rec.file_data directory if available
            if (rec.file_data) {
              const baseDir = rec.file_data.split('/').slice(0, -1).join('/');
              const objPath = baseDir ? `${baseDir}/${candidate}` : candidate;
              try {
                const { data: signed, error: signErr } = await supabaseStorage.storage.from('html-files').createSignedUrl(objPath, 60 * 60);
                if (!signErr && signed) return signed.signedUrl || signed.signedURL;
              } catch (e) { console.error('signed err3', e); }
            }

            // fallback: return original (might be absolute or will break)
            return candidate;
          };

          // Collect unique URLs to replace
          const urlSet = new Set();
          const attrRegex = /(?:src|href|data-src)=(["'])([^"']+)\1/gi;
          let match;
          while ((match = attrRegex.exec(html)) !== null) {
            urlSet.add(match[2]);
          }
          // srcset support (comma separated list)
          const srcsetRegex = /srcset=(["'])([^"']+)\1/gi;
          while ((match = srcsetRegex.exec(html)) !== null) {
            const items = match[2].split(',').map(s => s.trim().split(' ')[0]);
            items.forEach(u => { if (u) urlSet.add(u); });
          }

          const replacements = {};
          for (const u of Array.from(urlSet)) {
            try {
              const signed = await genSigned(u);
              if (signed && signed !== u) replacements[u] = signed;
            } catch (e) {
              console.error('Error genSigned for', u, e);
            }
          }

          // Apply replacements
          let newHtml = html;
          for (const [orig, rep] of Object.entries(replacements)) {
            // replace exact occurrences in attributes
            const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            newHtml = newHtml.replace(new RegExp(`([\"'])${esc}([\"'])`, 'g'), `$1${rep}$2`);
            // srcset items: handle values inside comma-separated lists
            newHtml = newHtml.replace(new RegExp(`(?:srcset=([\"'])(?:[^\"']*?)?)${esc}(?:[^\"']*?)?\\1`, 'g'), (m) => m.replace(new RegExp(esc, 'g'), rep));
          }

          // send modified HTML as attachment
          const buffer = Buffer.from(newHtml, 'utf8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Content-Length', buffer.length);
          res.setHeader('Content-Disposition', `attachment; filename="${String(filename).replace(/\"/g, '')}"`);
          return res.end(buffer);
        } catch (e) {
          console.error('Error processing HTML for download:', e);
          // fallback to streaming raw
        }
      }

      // Non-HTML or fallback: stream as binary
      res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      res.setHeader('Content-Disposition', `attachment; filename="${String(filename).replace(/\"/g, '')}"`);

      try {
        let nodeStream;
        if (fetchRes.body && typeof fetchRes.body.pipe === 'function') {
          nodeStream = fetchRes.body;
        } else if (fetchRes.body && typeof Readable.fromWeb === 'function') {
          nodeStream = Readable.fromWeb(fetchRes.body);
        } else {
          const buf = Buffer.from(await fetchRes.arrayBuffer());
          return res.end(buf);
        }

        res.on('close', () => {
          try { if (nodeStream && typeof nodeStream.destroy === 'function') nodeStream.destroy(); } catch (e) {}
        });
        await pipelineAsync(nodeStream, res);
        return;
      } catch (e) {
        console.error('Error streaming file:', e);
        if (!res.headersSent) return res.status(500).json({ error: 'Error streaming file' });
        return;
      }
    };

    // If URL is absolute and looks like HTML -> stream to force download
    if (/^https?:\/\//i.test(url) && looksLikeHtml(url)) {
      return await streamUrlAsAttachment(url);
    }

    // Otherwise generate signed URL if needed
    try {
      let finalUrl = null;
      const m = String(url).match(/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
      if (m) {
        const bucket = m[1];
        const objectPath = decodeURIComponent(m[2]);
        const { data: signed, error: signErr } = await supabaseStorage.storage.from(bucket).createSignedUrl(objectPath, 60);
        if (signErr || !signed) {
          console.error('Error creating signed URL (public-path):', signErr);
          return res.status(500).json({ error: 'Could not generate download URL' });
        }
        finalUrl = signed.signedUrl || signed.signedURL;
      } else {
        const objectPath = url;
        const { data: signed2, error: signErr2 } = await supabaseStorage.storage.from('html-files').createSignedUrl(objectPath, 60);
        if (signErr2 || !signed2) {
          console.error('Error creating signed URL (default bucket):', signErr2);
          return res.status(500).json({ error: 'Could not generate download URL' });
        }
        finalUrl = signed2.signedUrl || signed2.signedURL;
      }

      if (!finalUrl) return res.status(500).json({ error: 'Could not determine download URL' });

      // If we have a DB filename, stream the final URL and force Content-Disposition with that filename.
      if (rec && (rec.filename || rec.name)) {
        return await streamUrlAsAttachment(finalUrl);
      }

      if (looksLikeHtml(finalUrl)) {
        return await streamUrlAsAttachment(finalUrl);
      }

      // Non-HTML and no DB filename: redirect to signed URL
      return res.redirect(302, finalUrl);
    } catch (e) {
      console.error('Error generating signed URL:', e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (e) {
    console.error('Download endpoint error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/file/:id/like -> incrementar contador de likes
router.post('/file/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[LIKE] request for file id=', id, 'body=', req.body, 'cookieHeader=', req.headers && req.headers.cookie);
    const isDuplicateKey = (err) => {
      if (!err) return false;
      const code = err.code || err?.details?.code;
      const msg = String(err.message || err || '').toLowerCase();
      return code === '23505' || msg.includes('duplicate key value') || msg.includes('unique constraint');
    };
    // prefer explicit user_id in body, otherwise try to read cookie 'systecode_user_id'
    const { user_id: bodyUserId } = req.body || {};
    const parseCookies = (cookieHeader = '') => {
      return (cookieHeader || '').split(';').map(c => c.trim()).reduce((acc, cur) => {
        if (!cur) return acc;
        const parts = cur.split('=');
        acc[parts[0]] = decodeURIComponent(parts.slice(1).join('='));
        return acc;
      }, {});
    };
    const cookieUserId = parseCookies(req.headers && req.headers.cookie)["systecode_user_id"];
    // prefer numeric DB user id; many schemas expect integer user_id. If cookie/user id is non-numeric (UUID),
    // we treat it as anonymous like to avoid integer cast errors. To support UUID-based anonymous likes,
    // consider adding a text column (e.g. anon_id) to `file_likes`.
    const candidateUserId = bodyUserId || cookieUserId || null;
    const isNumericUserId = candidateUserId && /^\d+$/.test(String(candidateUserId));
    const user_id = isNumericUserId ? candidateUserId : null;
    if (!isNumericUserId && candidateUserId) console.log('[LIKE] received non-numeric user id; treating as anonymous like:', candidateUserId);
    console.log('[LIKE] resolved user_id=', user_id ? user_id : '(anonymous)');
    // if user_id provided (numeric), avoid duplicate likes by same user
    if (user_id) {
      const { data: exists, error: exErr } = await supabaseDB.from('file_likes').select('id').eq('file_id', id).eq('user_id', user_id).limit(1);
      if (exErr) {
        console.error('[LIKE] exists check error:', exErr);
        return res.status(500).json({ error: (exErr && exErr.message) || String(exErr) });
      }
      if (exists && exists.length > 0) {
        // return current count
        const { data: rows, error: cntErr } = await supabaseDB.from('file_likes').select('file_id').eq('file_id', id);
        if (cntErr) {
          console.error('[LIKE] count after exists error:', cntErr);
          return res.status(500).json({ error: (cntErr && cntErr.message) || String(cntErr) });
        }
        return res.json({ data: { likes: rows.length } });
      }
      const { error: insErr } = await supabaseDB.from('file_likes').insert({ file_id: id, user_id });
      if (insErr) {
        if (isDuplicateKey(insErr)) {
          // idempotent behavior: already liked by this user (or race condition double-click)
          console.log('[LIKE] duplicate like ignored (user)');
        } else {
          console.error('[LIKE] insert error (user):', insErr);
          return res.status(500).json({ error: (insErr && insErr.message) || String(insErr) });
        }
      }
    } else {
      // anonymous like (insert without user)
      const { error: insErr } = await supabaseDB.from('file_likes').insert({ file_id: id });
      if (insErr) {
        if (isDuplicateKey(insErr)) {
          console.log('[LIKE] duplicate like ignored (anon)');
        } else {
          console.error('[LIKE] insert error (anon):', insErr);
          return res.status(500).json({ error: (insErr && insErr.message) || String(insErr) });
        }
      }
    }

    // return new likes count
    const { data: rows, error: cntErr } = await supabaseDB.from('file_likes').select('file_id').eq('file_id', id);
    if (cntErr) return res.status(500).json({ error: (cntErr && cntErr.message) || String(cntErr) });
    return res.json({ data: { likes: (rows && rows.length) || 0 } });
  } catch (e) {
    console.error('Like endpoint error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/storage-files -> lista objetos en el bucket de Storage
router.get('/storage-files', async (req, res) => {
  try {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || SUPABASE_STORAGE_BUCKET || 'files';
    const { data, error } = await supabaseStorage.storage.from(bucket).list('');
    if (error) {
      console.warn('Supabase storage list error:', error.message || error);
      return res.status(500).json({ error: (error && error.message) || String(error) });
    }
    return res.json({ data });
  } catch (e) {
    console.error('Storage list exception:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
