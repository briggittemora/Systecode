#!/usr/bin/env node
/*
  Script: migrate-previews-to-cloudinary.js
  - Busca filas en `html_files` con `preview_image_url` o `preview_video_url`.
  - Intenta descargar la URL (desde Supabase). Si falla y se pasa --localDir, intenta leer archivo local.
  - Sube el contenido a Cloudinary y actualiza la fila con la nueva URL.

  Uso:
    node migrate-previews-to-cloudinary.js [--localDir=./downloads] [--limit=100]

  Nota: si tu proyecto Supabase tiene servicios restringidos por cuota, las descargas directas fallarán.
  En ese caso, descarga los archivos manualmente desde el panel (o usa un backup) y pásalos en --localDir.
*/

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const util = require('util');
const readFile = util.promisify(fs.readFile);

const { supabaseDB } = require('../src/supabaseClient');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const argv = process.argv.slice(2);
const opts = {};
for (const a of argv) {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  if (m) opts[m[1]] = m[2] || true;
}

const LOCAL_DIR = opts.localDir ? String(opts.localDir) : null;
const LIMIT = opts.limit ? Number(opts.limit) : 200;

const getFetch = () => {
  if (typeof fetch === 'function') return fetch;
  try { return require('node-fetch'); } catch (e) { return null; }
};

const fetcher = getFetch();

const downloadToBuffer = async (url) => {
  if (!fetcher) throw new Error('No fetch available. Install node-fetch or run on Node18+.');
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
};

const uploadBufferToCloudinary = async (buffer, mime, folder, originalName, resourceType='image') => {
  const b64 = buffer.toString('base64');
  const dataUri = `data:${mime};base64,${b64}`;
  // derive public_id from originalName (no extension)
  const baseName = String(originalName || '').replace(/\.[^.]+$/, '');
  const publicId = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const opts = { resource_type: resourceType, folder, public_id: publicId, overwrite: true };
  const result = await cloudinary.uploader.upload(dataUri, opts);
  return result && (result.secure_url || result.url) ? (result.secure_url || result.url) : null;
};

const extractFilenameFromUrl = (u) => {
  try {
    const url = new URL(u);
    return decodeURIComponent(url.pathname.split('/').pop() || 'file');
  } catch (e) { return path.basename(String(u || 'file')); }
};

// Busca recursivamente un archivo por nombre dentro de 'root'. Devuelve la ruta completa o null.
const findLocalFile = async (root, name) => {
  const target = String(name).toLowerCase();
  const walk = async (dir) => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return null; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const found = await walk(full);
        if (found) return found;
      } else if (ent.isFile()) {
        if (String(ent.name).toLowerCase() === target) return full;
      }
    }
    return null;
  };
  return walk(root);
};

const run = async () => {
  console.log('Migración previews -> Cloudinary (limit=' + LIMIT + ')');
  // Query rows with preview urls
  const { data: rows, error } = await supabaseDB.from('html_files')
    .select('id, preview_image_url, preview_video_url')
    .limit(LIMIT);
  if (error) {
    console.error('Error leyendo html_files:', error.message || error);
    process.exit(1);
  }
  console.log('Filas a procesar:', rows.length);

  for (const r of rows) {
    const updates = {};
    if (r.preview_image_url) {
      const fname = extractFilenameFromUrl(r.preview_image_url);
          const folder = 'previews';
      let buffer = null;
      let mime = 'image/jpeg';
      try {
        console.log('Descargando imagen desde:', r.preview_image_url);
        buffer = await downloadToBuffer(r.preview_image_url);
      } catch (e) {
        console.warn('No se pudo descargar desde Supabase:', e.message || e);
        if (LOCAL_DIR) {
          const localPath = await findLocalFile(LOCAL_DIR, fname);
          if (localPath) {
            try {
              buffer = await readFile(localPath);
              console.log('Leído desde local:', localPath);
            } catch (le) {
              console.warn('Error leyendo local', localPath, le.message || le);
            }
          } else {
            console.warn('No se encontró el archivo local para', fname);
          }
        }
      }
      if (buffer) {
        try {
          const newUrl = await uploadBufferToCloudinary(buffer, mime, folder, fname, 'image');
          console.log('Subido a Cloudinary:', newUrl);
          updates.preview_image_url = newUrl;
        } catch (e) { console.error('Cloudinary upload failed:', e.message || e); }
      }
    }

    if (r.preview_video_url) {
      const fname = extractFilenameFromUrl(r.preview_video_url);
      const folder = 'previews';
      let buffer = null;
      let mime = 'video/mp4';
      try {
        console.log('Descargando video desde:', r.preview_video_url);
        buffer = await downloadToBuffer(r.preview_video_url);
      } catch (e) {
        console.warn('No se pudo descargar desde Supabase:', e.message || e);
        if (LOCAL_DIR) {
          const localPath = await findLocalFile(LOCAL_DIR, fname);
          if (localPath) {
            try {
              buffer = await readFile(localPath);
              console.log('Leído desde local:', localPath);
            } catch (le) {
              console.warn('Error leyendo local', localPath, le.message || le);
            }
          } else {
            console.warn('No se encontró el archivo local para', fname);
          }
        }
      }
      if (buffer) {
        try {
          const newUrl = await uploadBufferToCloudinary(buffer, mime, folder, fname, 'video');
          console.log('Subido a Cloudinary:', newUrl);
          updates.preview_video_url = newUrl;
        } catch (e) { console.error('Cloudinary upload failed:', e.message || e); }
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        const { data: upd, error: upErr } = await supabaseDB.from('html_files').update(updates).eq('id', r.id).select();
        if (upErr) console.error('DB update error for id', r.id, upErr.message || upErr);
        else console.log('Fila actualizada:', r.id);
      } catch (e) { console.error('DB update exception:', e); }
    } else {
      console.log('Nada que actualizar para id', r.id);
    }
  }
  console.log('Migración finalizada');
  process.exit(0);
};

run().catch((e) => { console.error('Fatal error', e); process.exit(1); });
