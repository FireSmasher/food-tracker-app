// Supabase project connection. Fill these in yourself after creating the project — see
// HANDOFF.md, "Setup: Supabase" section, for the exact steps.
//
// The anon key is SAFE to be public and commit to this public repo — that's how Supabase's
// anon key is designed to work. Row Level Security (see supabase/schema.sql) is the actual
// security boundary, not secrecy of this key. Never put a service_role key here, or anywhere
// in this repo — that key bypasses Row Level Security entirely and must only ever live in a
// local, untracked config file read by Nippard/Sevro's own query script (see scripts/).
const SUPABASE_URL = ''; // e.g. https://abcdefghijkl.supabase.co
const SUPABASE_ANON_KEY = '';
