require('dotenv').config({ path: './backend/.env' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_DB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

(async () => {
  try {
    const { data, error } = await supabase.from('html_files').select('*').limit(5);
    console.log('DB test result:');
    if (error) console.log('error:', error.message || error);
    else console.log('rows:', data ? data.length : 0, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('exception:', e && e.message ? e.message : e);
  }
  process.exit(0);
})();
