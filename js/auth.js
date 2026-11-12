/* Life.OS — accounts and cloud copy, via Supabase (hosted Postgres + Auth).
   Active only when js/config.js has a Supabase URL and anon key; otherwise window.LifeAuth.enabled is false and the
   app keeps working locally (and in the older Google Drive mode). Row Level Security means this file can talk to the
   database directly: the anon key can only ever reach the signed-in user's own row. */
(function () {
  'use strict';
  const cfg = window.LIFEOS_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  const listeners = [];
  let client = null, session = null;
  const notify = (event) => listeners.slice().forEach((f) => { try { f(event, session); } catch (e) { console.error(e); } });

  if (enabled) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
    client.auth.onAuthStateChange((event, s) => { session = s; notify(event); });
    client.auth.getSession().then(({ data }) => { session = data.session; notify('INITIAL_SESSION'); });
  }

  const here = () => window.location.origin + window.location.pathname;
  const need = () => { if (!enabled) throw new Error('Accounts are not configured.'); return client; };
  const uid = () => { if (!session) throw new Error('Not signed in'); return session.user.id; };

  window.LifeAuth = {
    enabled,
    session: () => session,
    user: () => (session ? session.user : null),
    accessToken: () => (session ? session.access_token : ''),
    provider: () => (session && session.user.app_metadata ? session.user.app_metadata.provider : ''),
    onChange(fn) { listeners.push(fn); },
    async signInWithGoogle() { const { error } = await need().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here(), scopes: 'openid email profile' } }); if (error) throw error; },
    async signInWithApple() { const { error } = await need().auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: here() } }); if (error) throw error; },
    async signInWithEmail(email, password) { const { data, error } = await need().auth.signInWithPassword({ email, password }); if (error) throw error; return data; },
    async signUpWithEmail(email, password) { const { data, error } = await need().auth.signUp({ email, password, options: { emailRedirectTo: here() } }); if (error) throw error; return data; },
    async signOut() { const { error } = await need().auth.signOut(); if (error) throw error; },

    /* The plan row. pull() -> {data, updated_at, version} | null. push() only overwrites the version you last saw:
       expected is that version's updated_at, or null when you believe there is no row yet. Returns the new updated_at,
       or null when someone else wrote first (the caller then pulls, merges and tries again). */
    async pull() {
      const { data, error } = await need().from('plans').select('data, updated_at, version').eq('user_id', uid()).limit(1);
      if (error) throw error;
      return data && data.length ? data[0] : null;
    },
    async push(payload, expected) {
      const c = need();
      if (!expected) {
        const { data, error } = await c.from('plans').insert({ user_id: uid(), data: payload, version: payload.version || 1 }).select('updated_at');
        if (error) { if (error.code === '23505') return null; throw error; }
        return data && data[0] ? data[0].updated_at : null;
      }
      const { data, error } = await c.from('plans').update({ data: payload, version: payload.version || 1 }).eq('user_id', uid()).eq('updated_at', expected).select('updated_at');
      if (error) throw error;
      return data && data.length ? data[0].updated_at : null;
    },
    /* Photo import waitlist: insert-only through Row Level Security. A duplicate email counts as success. */
    async joinWaitlist(row) {
      const { error } = await need().from('waitlist').insert(row);
      if (error && error.code !== '23505') throw error;
    },
    /* Removes the plan row, then the account itself through the delete-user Edge Function. */
    async deleteAccount() {
      const c = need();
      const { error } = await c.from('plans').delete().eq('user_id', uid());
      if (error) throw error;
      const { error: fe } = await c.functions.invoke('delete-user', { method: 'POST' });
      if (fe) throw fe;
      await c.auth.signOut().catch(() => {});
    },
  };
})();
