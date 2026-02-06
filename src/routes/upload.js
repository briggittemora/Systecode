const express = require('express');
const multer = require('multer');
const slugify = require('slugify');
const { Octokit } = require('@octokit/rest');
const { supabaseDB, supabaseStorage, SUPABASE_STORAGE_BUCKET } = require('../supabaseClient');
const { getSupabaseUserFromRequest, getUserRowByEmail } = require('../utils/supabaseAuth');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

const GHP_TOKEN = process.env.GHPAGES_TOKEN;
const GHP_OWNER = process.env.GHPAGES_OWNER;
const GHP_REPO = process.env.GHPAGES_REPO;
const GHP_BRANCH = process.env.GHPAGES_BRANCH || 'main';
const GHP_BASE_URL = process.env.GHPAGES_BASE_URL;
const octokit = GHP_TOKEN ? new Octokit({ auth: GHP_TOKEN }) : null;

// POST /api/upload
router.post('/upload', upload.fields([
  { name: 'preview', maxCount: 1 },
  { name: 'htmlFile', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]), async (req, res) => {
  try {
    // Requiere sesión para subir (miembros y admin)
    const { user } = await getSupabaseUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión para subir archivos.' });
    }

    // Consultar rol del usuario en tabla users
    const email = user.email;
    const { row: dbUser } = await getUserRowByEmail(email);
    const rol = String(dbUser?.rol || '').toLowerCase();

    const { name, description, type = 'free', price, category = 'otro' } = req.body;
    // accept epago either as `epago` or `price` form field
    const epagoInputRaw = (req.body && (typeof req.body.epago !== 'undefined')) ? req.body.epago : price;
    const previewFile = req.files && req.files.preview && req.files.preview[0];
    const htmlFile = req.files && req.files.htmlFile && req.files.htmlFile[0];
    const thumbnailFile = req.files && req.files.thumbnail && req.files.thumbnail[0];

    if (!name || !htmlFile) return res.status(400).json({ error: 'name and htmlFile are required' });

    const slug = slugify(name, { lower: true, strict: true });
    const timestamp = Date.now();
    const id = `${timestamp}`;

    // upload helper - more robust: handle upload errors, get public url from response
    const uploadToBucket = async (path, buffer, mime) => {
      // try upload (don't upsert by default)
      let upRes = await supabaseStorage.storage.from(SUPABASE_STORAGE_BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
      if (upRes.error) {
        // if object exists or conflict, try with upsert=true
        const msg = String(upRes.error.message || upRes.error || '').toLowerCase();
        if (msg.includes('already exists') || msg.includes('object already exists') || msg.includes('file exists')) {
          const retry = await supabaseStorage.storage.from(SUPABASE_STORAGE_BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
          if (retry.error) throw retry.error;
          upRes = retry;
        } else {
          throw upRes.error;
        }
      }

      // get public URL (different SDKs return shape slightly different)
      try {
        const pub = supabaseStorage.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
        // new SDK: { data: { publicUrl } }, older: { publicURL }
        const publicUrl = (pub && pub.data && (pub.data.publicUrl || pub.data.publicURL)) || pub && (pub.publicURL || pub.publicUrl) || null;
        if (publicUrl) return publicUrl;
      } catch (e) {
        // ignore and fallback
      }

      // fallback: construct public path if storage URL known
      const storageBase = process.env.SUPABASE_STORAGE_URL || process.env.SUPABASE_URL || '';
      if (storageBase) {
        return `${storageBase.replace(/\/$/, '')}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${encodeURIComponent(path)}`;
      }

      return null;
    };

    let previewImagePublicUrl = null;
    let previewVideoPublicUrl = null;
    if (previewFile) {
      const previewPath = `previews/${id}_${previewFile.originalname}`;
      try {
        const uploaded = await uploadToBucket(previewPath, previewFile.buffer, previewFile.mimetype);
        if (uploaded) {
          // decide whether it's video or image by mimetype
          if (String(previewFile.mimetype || '').startsWith('video/')) {
            previewVideoPublicUrl = uploaded;
          } else {
            previewImagePublicUrl = uploaded;
          }
        }
      } catch (e) {
        console.warn('Supabase preview upload error:', e.message || e);
      }
    }

    if (thumbnailFile) {
      // optional thumbnail upload (not saved in DB separately here)
      const thumbPath = `thumbs/${id}_${thumbnailFile.originalname}`;
      try {
        await uploadToBucket(thumbPath, thumbnailFile.buffer, thumbnailFile.mimetype);
      } catch (e) {
        console.warn('Supabase thumbnail upload error:', e.message || e);
      }
    }

    // HTML upload
    const htmlPath = `html/${id}_${htmlFile.originalname}`;
    let htmlPublicUrl = null;
    try {
      htmlPublicUrl = await uploadToBucket(htmlPath, htmlFile.buffer, htmlFile.mimetype);
    } catch (e) {
      console.warn('Supabase html upload error:', e.message || e);
    }

    // Optionally publish on GH pages
    let fileUrl = null;
    if (octokit && GHP_OWNER && GHP_REPO) {
      try {
        const filePath = `files/${id}_${slug}.html`;
        const contentBase64 = Buffer.from(htmlFile.buffer).toString('base64');
        const params = { owner: GHP_OWNER, repo: GHP_REPO, path: filePath, message: `Add file ${filePath}`, content: contentBase64, branch: GHP_BRANCH };
        try {
          const existing = await octokit.repos.getContent({ owner: GHP_OWNER, repo: GHP_REPO, path: filePath, ref: GHP_BRANCH });
          if (existing && existing.data && existing.data.sha) params.sha = existing.data.sha;
        } catch (e) {}
        await octokit.repos.createOrUpdateFileContents(params);
        if (GHP_BASE_URL) fileUrl = `${GHP_BASE_URL}/${filePath}`;
      } catch (e) {
        console.warn('GitHub Pages publish error:', e.message || e);
      }
    }

    // decide tipo and epago to store
    const epagoInput = (epagoInputRaw === null || typeof epagoInputRaw === 'undefined') ? null : String(epagoInputRaw).trim();
    let tipoFinal = (String(type || '').toLowerCase() === 'vip') ? 'vip' : 'free';
    let epagoToStore = null;
    let priceUsdToStore = null;
    if (epagoInput) {
      const l = epagoInput.toLowerCase();
      if (l === 'vip') {
        tipoFinal = 'vip';
        epagoToStore = 'vip';
        priceUsdToStore = 2;
      } else if (l === 'gratuito' || l === 'gratis' || l === 'free') {
        tipoFinal = 'free';
        epagoToStore = epagoInput; // keep original text like 'gratuito'
      } else if (!isNaN(Number(l))) {
        const n = Number(l);
        epagoToStore = n;
        if (n > 0) tipoFinal = 'vip';
        if (n > 0) priceUsdToStore = n;
      } else {
        // unknown string: preserve as-is but don't force vip
        epagoToStore = epagoInput;
      }
    }

    // If VIP but no numeric price parsed, default to $2
    if (tipoFinal === 'vip' && (!Number.isFinite(Number(priceUsdToStore)) || Number(priceUsdToStore) <= 0)) {
      priceUsdToStore = 2;
    }

    // Reglas de subida:
    // - rol=admin puede subir vip y free
    // - rol=miembro (o vacío) solo puede subir free
    if (tipoFinal === 'vip' && rol !== 'admin') {
      return res.status(403).json({ error: 'Solo un admin puede subir archivos VIP.' });
    }

    // insert metadata - use DB column names (spanish) and fail if insert fails
    let dbRecord = null;
    try {
      const insertPayload = {
        filename: name,
        user_id: dbUser?.id || user?.id || null,
        file_data: htmlPath,
        categoria: category,
        tipo: tipoFinal,
        epago: epagoToStore,
        price_usd: (tipoFinal === 'vip') ? Number(priceUsdToStore) : null,
        descripcion: description || null,
        preview_image_url: previewImagePublicUrl,
        preview_video_url: previewVideoPublicUrl,
        supabase_url: htmlPublicUrl,
        file_url: fileUrl
      };
      let { data: insertData, error: insertError } = await supabaseDB.from('html_files').insert([insertPayload]).select();
      if (insertError) {
        const msg = String(insertError.message || insertError || '');
        // If DB hasn't been migrated yet, retry without price_usd
        if (msg.toLowerCase().includes('price_usd') && msg.toLowerCase().includes('does not exist')) {
          const retryPayload = { ...insertPayload };
          delete retryPayload.price_usd;
          const retry = await supabaseDB.from('html_files').insert([retryPayload]).select();
          insertData = retry.data;
          insertError = retry.error;
        }
      }
      if (insertError) {
        console.warn('Supabase insert error:', insertError.message || insertError);
        return res.status(500).json({ error: (insertError && insertError.message) || String(insertError) });
      }
      dbRecord = insertData && insertData[0];
    } catch (e) {
      console.warn('DB insert exception:', e.message || e);
      return res.status(500).json({ error: (e && e.message) || String(e) });
    }

    const previewPublicUrl = previewVideoPublicUrl || previewImagePublicUrl || null;
    return res.json({
      success: true,
      data: {
        id: dbRecord?.id,
        name,
        slug,
        category,
        type: tipoFinal,
        price: (tipoFinal === 'vip') ? Number(priceUsdToStore) : null,
        preview: previewPublicUrl,
        html: htmlPublicUrl,
        file: fileUrl,
        db: dbRecord,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
