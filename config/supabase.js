const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Server-side client uses SERVICE KEY — bypasses RLS
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
);

module.exports = supabase;
