/* Life.OS public configuration. Everything here is safe to publish: the Supabase anon key only works through
   Row Level Security, and the PostHog key is a write-only project key.
   Leave supabaseUrl empty to run in the older Google-Drive mode; fill it in to switch to accounts (see DEPLOY.md). */
window.LIFEOS_CONFIG = {
  supabaseUrl: '',          // https://YOUR-PROJECT.supabase.co
  supabaseAnonKey: '',      // the project's anon (public) key
  posthogKey: '',           // optional: PostHog project API key for the five funnel events
  posthogHost: 'https://us.i.posthog.com',
  billing: false,           // true once Stripe is set up on the server: shows Upgrade / Manage billing in Settings
  plusPrice: '',            // shown on the upgrade button, e.g. '$8/month' (you decide)
  posthogDashboard: '',     // optional link the admin page shows as "Open analytics"
  identifyEmail: false,     // send the account email to analytics? Off by default; the user id is enough
};
