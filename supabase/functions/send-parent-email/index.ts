// Supabase Edge Function: send-parent-email
//
// Sends a parent-update email through a Gmail account via SMTP, so the
// system can send "as WAAPC Training Centre" without exposing any email
// credentials to the browser. Deploy this once, set the two secrets below,
// and the "Send automatically" button in the app starts working — no
// further code changes needed.
//
// Deploy (from the project root, with the Supabase CLI installed and
// linked to your project — see README.md "Automated parent emails"):
//   supabase functions deploy send-parent-email
//   supabase secrets set GMAIL_USER=your-school-account@gmail.com
//   supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
//
// The app password is generated at https://myaccount.google.com/apppasswords
// (requires 2-Step Verification to be turned on for that Gmail account
// first) — it is NOT the account's normal login password.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
    }

    // Acts as the calling user (not a service role) so RLS still applies —
    // this only proves who's calling and lets us check their role below.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (!profile || (profile.role !== 'admin' && profile.role !== 'teacher')) {
      return new Response(JSON.stringify({ error: 'Only admin or teacher accounts can send parent emails.' }), { status: 403 });
    }

    const { to, subject, body } = await req.json();
    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing to, subject, or body.' }), { status: 400 });
    }

    const gmailUser = Deno.env.get('GMAIL_USER');
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ error: 'Email sending is not configured yet. Set GMAIL_USER and GMAIL_APP_PASSWORD as function secrets.' }),
        { status: 500 }
      );
    }

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    });

    await client.send({
      from: `WAAPC Training Centre <${gmailUser}>`,
      to,
      subject,
      content: body,
    });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('send-parent-email failed:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to send email.' }), { status: 500 });
  }
});
