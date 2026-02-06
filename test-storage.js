require('dotenv').config({ path: './backend/.env' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_STORAGE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_STORAGE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'html-files';
const supabase = createClient(url, key);

(async () => {
  try {
    const { data, error } = await supabase.storage.from(bucket).list('', { limit: 10 });
    console.log('Storage test result:');
    if (error) console.log('error:', error.message || error);
    else console.log('objects:', data ? data.length : 0, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('exception:', e && e.message ? e.message : e);
  }
  process.exit(0);
})();
