// Public by design: the project URL and the anon key ship in every browser
// bundle. Row-level security in the relay schema is what protects the data.
export const SUPABASE_URL = 'https://nxekrfdagkdwhjuunsrl.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_hv-9Mb3Y36PklJ2Yo4KBhw_XEy3z5lP';
export const SCHEMA = 'relay';

// Sign-in returns to the app's own base URL: origin + the directory of the
// page, never the query or fragment (a leftover #access_token would become
// ##access_token on the next attempt and break the fragment parser).
// Live: https://adamnc02.github.io/relay/. Locally: http://localhost:8000/relay/
// or http://localhost:8000/. Each must be in Supabase's Redirect URLs allow-list.
export function redirectTo() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

export const SUPABASE_JS_VERSION = '2.116.0';

// Web Push: the public half of the project's VAPID key pair (public by
// definition). The relay-push Edge Function signs with the matching private
// key; if the two differ, every push is refused with 403.
export const VAPID_PUBLIC_KEY = 'BB9I-sjb0TW_tjurRCh29HZ1Eab_sZBHKqnt1c7rBsagJxWDau0BnBCjybagPVJVIxImeOP87anjAKsVZX839Fk';
