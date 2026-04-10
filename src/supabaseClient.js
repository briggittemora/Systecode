require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const isUsableSupabaseUrl = (value) => {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const u = new URL(text);
    if (!/^https?:$/.test(u.protocol)) return false;
    // app.supabase.com is dashboard URL, not API URL for storage/auth.
    if (u.hostname.toLowerCase() === 'app.supabase.com') return false;
    return true;
  } catch {
    return false;
  }
};

const pickSupabaseUrl = (preferred, fallback, label) => {
  if (isUsableSupabaseUrl(preferred)) return String(preferred).trim();
  if (preferred) {
    console.warn(`Warning: ${label} is set but invalid. Falling back to SUPABASE_URL.`);
  }
  if (isUsableSupabaseUrl(fallback)) return String(fallback).trim();
  return String(fallback || preferred || '').trim();
};

// Support separate Supabase projects for DB and Storage
// DB project (where the Postgres 'files' table lives)
const SUPABASE_DB_URL = pickSupabaseUrl(process.env.SUPABASE_DB_URL, process.env.SUPABASE_URL, 'SUPABASE_DB_URL');
const SUPABASE_DB_SERVICE_ROLE_KEY = process.env.SUPABASE_DB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Storage project (where buckets live)
const SUPABASE_STORAGE_URL = pickSupabaseUrl(process.env.SUPABASE_STORAGE_URL, process.env.SUPABASE_URL, 'SUPABASE_STORAGE_URL');
const SUPABASE_STORAGE_SERVICE_ROLE_KEY = process.env.SUPABASE_STORAGE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'files';

if (!SUPABASE_DB_URL || !SUPABASE_DB_SERVICE_ROLE_KEY) {
  console.warn('Warning: SUPABASE_DB_URL or SUPABASE_DB_SERVICE_ROLE_KEY not set in .env');
}
if (!SUPABASE_STORAGE_URL || !SUPABASE_STORAGE_SERVICE_ROLE_KEY) {
  console.warn('Warning: SUPABASE_STORAGE_URL or SUPABASE_STORAGE_SERVICE_ROLE_KEY not set in .env');
}

const supabaseDB = createClient(SUPABASE_DB_URL, SUPABASE_DB_SERVICE_ROLE_KEY);
const supabaseStorage = createClient(SUPABASE_STORAGE_URL, SUPABASE_STORAGE_SERVICE_ROLE_KEY);

module.exports = {
  supabaseDB,
  supabaseStorage,
  SUPABASE_STORAGE_BUCKET,
};
