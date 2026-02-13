#!/usr/bin/env node
require('dotenv').config();
const { supabaseDB } = require('./src/supabaseClient');

async function check(email) {
  if (!email) {
    console.error('Usage: node check_user.js user@example.com');
    process.exit(2);
  }

  try {
    const { data, error } = await supabaseDB.from('users').select('*').eq('email', email).limit(1);
    if (error) {
      console.error('Query error:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) {
      console.log('No rows found for', email);
      process.exit(0);
    }
    console.log('Found row:', JSON.stringify(data[0], null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Unexpected error:', e?.message || e);
    process.exit(1);
  }
}

const email = process.argv[2];
check(email);
