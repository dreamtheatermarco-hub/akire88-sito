// Edge Function "newsletter": iscrizione con doppia conferma, conferma e disiscrizione.
// Versione in un unico file, da incollare nell'editor di Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.15";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://www.akire88.it,https://akire88.it").split(",").map((s) => s.trim());

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);

const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.trim().slice(0, max) : "";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Invio email tramite la casella di Register (SMTP con SSL).
async function sendMail(opts: { to: string; subject: string; text: string; html: string; replyTo?: string }) {
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
  const transporter = nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") },
  });
  await transporter.sendMail({
    from: `"Akire88" <${Deno.env.get("MAIL_FROM") ?? Deno.env.get("SMTP_USER")}>`,
    ...opts,
  });
}

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://www.akire88.it";
const NOTIFY_TO = Deno.env.get("NOTIFY_TO") ?? "assistenza@akire88.it";

// Cornice grafica delle email
function mailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#081C28;padding:32px 16px;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0E2A3B;border:1px solid #1C4256;border-radius:20px">
<tr><td style="padding:32px 32px 8px;font-size:22px;font-weight:bold;color:#E6FFFA">Akire<span style="color:#2DD4BF">88</span></td></tr>
<tr><td style="padding:8px 32px 0;font-size:20px;font-weight:bold;color:#E6FFFA">${title}</td></tr>
<tr><td style="padding:16px 32px 32px;font-size:15px;line-height:1.6;color:#C2DCE4">${bodyHtml}</td></tr>
</table>
<p style="font-size:12px;color:#8FB7C4;margin:16px 0 0">© ${new Date().getFullYear()} Akire88 · <a href="${SITE_URL}/privacy.html" style="color:#8FB7C4">Privacy</a></p>
</td></tr></table></body></html>`;
}

// ---------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sendConfirmEmail(email: string, token: string) {
  const link = `${SITE_URL}/newsletter.html?azione=conferma&token=${token}`;
  await sendMail({
    to: email,
    subject: "Conferma l'iscrizione alla newsletter di Akire88",
    text: `Ciao! Per confermare l'iscrizione alla newsletter di Akire88 apri questo link:\n${link}\n\nSe non sei stato tu, ignora questa email: senza conferma non riceverai nulla.`,
    html: mailLayout(
      "Conferma la tua iscrizione",
      `<p style="margin:0 0 20px">Ciao! Per ricevere la newsletter di Akire88 conferma il tuo indirizzo con il pulsante qui sotto.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#2DD4BF;color:#081C28;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:24px">Confermo l'iscrizione</a></p>
<p style="margin:0;font-size:13px;color:#8FB7C4">Se non sei stato tu, ignora questa email: senza conferma non riceverai nulla.</p>`,
    ),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "method" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { ok: false, error: "bad-json" }, 400); }
  const supabase = db();
  const action = String(b.action ?? "");

  if (action === "subscribe") {
    if (clean(b.website, 200)) return json(req, { ok: true }); // trappola anti-spam
    const email = clean(b.email, 254).toLowerCase();
    if (!isEmail(email)) return json(req, { ok: false, error: "invalid" }, 400);

    const { data: found } = await supabase.from("newsletter_subscribers")
      .select("id, stato, token").eq("email", email).maybeSingle();

    // Già confermato: rispondiamo ok senza rivelare nulla.
    if (found?.stato === "confermato") return json(req, { ok: true });

    let token = found?.token as string | undefined;
    if (found) {
      const { data: upd, error } = await supabase.from("newsletter_subscribers")
        .update({ stato: "in_attesa", token: crypto.randomUUID(), unsubscribed_at: null })
        .eq("id", found.id).select("token").single();
      if (error) return json(req, { ok: false, error: "db" }, 500);
      token = upd.token;
    } else {
      const { data: ins, error } = await supabase.from("newsletter_subscribers")
        .insert({ email }).select("token").single();
      if (error) return json(req, { ok: false, error: "db" }, 500);
      token = ins.token;
    }
    try {
      await sendConfirmEmail(email, token!);
    } catch (e) {
      console.error("mail", e);
      return json(req, { ok: false, error: "mail" }, 502);
    }
    return json(req, { ok: true });
  }

  if (action === "confirm" || action === "unsubscribe") {
    const token = clean(b.token, 64);
    if (!UUID_RE.test(token)) return json(req, { ok: false, error: "invalid" }, 400);
    const patch = action === "confirm"
      ? { stato: "confermato", confirmed_at: new Date().toISOString() }
      : { stato: "disiscritto", unsubscribed_at: new Date().toISOString() };
    let q = supabase.from("newsletter_subscribers").update(patch).eq("token", token);
    if (action === "confirm") q = q.eq("stato", "in_attesa");
    const { data, error } = await q.select("id");
    if (error) return json(req, { ok: false, error: "db" }, 500);
    if (!data?.length) return json(req, { ok: false, error: "not-found" }, 404);
    return json(req, { ok: true });
  }

  return json(req, { ok: false, error: "action" }, 400);
});
