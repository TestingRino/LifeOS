// Deletes the signed-in user's auth record (their plan row goes with it via ON DELETE CASCADE).
// The browser cannot do this itself: removing an auth user needs the service-role key.
// Deploy:  supabase functions deploy delete-user
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: { user }, error } = await admin.auth.getUser(token);     // verifies the caller's JWT
  if (error || !user) return json({ error: 'Unauthorized' }, 401);

  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);   // cascades to plans
  if (delErr) return json({ error: delErr.message }, 500);
  return json({ success: true });
});
