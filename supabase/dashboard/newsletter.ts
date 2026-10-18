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
function makeTransport(pool = false) {
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
  return nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST"),
    port,
    secure: port === 465,
    pool,
    maxConnections: 1,
    auth: { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") },
  });
}

type MailOpts = {
  to: string; subject: string; text: string; html: string;
  replyTo?: string; headers?: Record<string, string>;
};

// deno-lint-ignore no-explicit-any
async function sendMail(opts: MailOpts, transporter?: any) {
  const t = transporter ?? makeTransport();
  await t.sendMail({
    from: `"Akire88" <${Deno.env.get("MAIL_FROM") ?? Deno.env.get("SMTP_USER")}>`,
    ...opts,
  });
}

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://www.akire88.it";
const NOTIFY_TO = Deno.env.get("NOTIFY_TO") ?? "assistenza@akire88.it";

// Cornice grafica delle email
function mailLayout(title: string, bodyHtml: string, footerHtml = ""): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#081C28;padding:32px 16px;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0E2A3B;border:1px solid #1C4256;border-radius:20px">
<tr><td style="padding:32px 32px 8px;font-size:22px;font-weight:bold;color:#E6FFFA">Akire<span style="color:#2DD4BF">88</span></td></tr>
${title ? `<tr><td style="padding:8px 32px 0;font-size:20px;font-weight:bold;color:#E6FFFA">${title}</td></tr>` : ""}
<tr><td style="padding:16px 32px 32px;font-size:15px;line-height:1.6;color:#C2DCE4">${bodyHtml}</td></tr>
</table>
<p style="font-size:12px;color:#8FB7C4;margin:16px 0 0">© ${new Date().getFullYear()} Akire88 · <a href="${SITE_URL}/privacy.html" style="color:#8FB7C4">Privacy</a></p>${footerHtml}
</td></tr></table></body></html>`;
}

// Newsletter: testo semplice → paragrafi HTML, pulsante facoltativo, link di disiscrizione.
type NewsletterInput = {
  subject: string; title: string; body: string; buttonText?: string; buttonUrl?: string;
};

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 600) return false;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}

function inlineFormat(s: string): string {
  // **grassetto** e link https://… cliccabili, dopo l'escape.
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#E6FFFA">$1</strong>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#5EEAD4">$1</a>');
}

function newsletterEmail(n: NewsletterInput, unsubscribeUrl: string) {
  const paras = n.body.trim().split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 16px">${inlineFormat(p).replace(/\n/g, "<br>")}</p>`
  ).join("");
  const button = n.buttonText && isHttpUrl(n.buttonUrl)
    ? `<p style="margin:8px 0 8px"><a href="${esc(n.buttonUrl)}" style="display:inline-block;background:#2DD4BF;color:#081C28;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:24px">${esc(n.buttonText)}</a></p>`
    : "";
  const footer = `<p style="font-size:12px;color:#8FB7C4;margin:8px 0 0">Ricevi questa email perché ti sei iscritto alla newsletter di Akire88. <a href="${esc(unsubscribeUrl)}" style="color:#8FB7C4">Disiscriviti</a></p>`;
  const html = mailLayout(esc(n.title), paras + button, footer);
  const text = `${n.title}\n\n${n.body.trim()}\n${
    n.buttonText && isHttpUrl(n.buttonUrl) ? `\n${n.buttonText}: ${n.buttonUrl}\n` : ""
  }\n—\nAkire88 · ${SITE_URL}\nPer disiscriverti: ${unsubscribeUrl}`;
  return { html, text };
}

// ---- Sessione del pannello admin (token firmato) ----
const SESSION_HOURS = Number(Deno.env.get("ADMIN_SESSION_HOURS") ?? "8");
const enc = new TextEncoder();

function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function hmac(data: string): Promise<string> {
  const secret = `${Deno.env.get("ADMIN_PASSWORD")}:${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeToken(): Promise<string> {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  return `${exp}.${await hmac(`admin:${exp}`)}`;
}

async function validToken(t: unknown): Promise<boolean> {
  if (typeof t !== "string") return false;
  const [expStr, sig] = t.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  return safeEqual(sig, await hmac(`admin:${exp}`));
}

// Risposta a un'email ricevuta: stessa grafica, testo, pulsante facoltativo e messaggio originale citato.
type ReplyInput = { title?: string; body: string; buttonText?: string; buttonUrl?: string };

function replyEmail(r: ReplyInput, quote?: { from: string; date: string; text: string }) {
  const paras = r.body.trim().split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 16px">${inlineFormat(p).replace(/\n/g, "<br>")}</p>`
  ).join("");
  const button = r.buttonText && isHttpUrl(r.buttonUrl)
    ? `<p style="margin:8px 0 8px"><a href="${esc(r.buttonUrl)}" style="display:inline-block;background:#2DD4BF;color:#081C28;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:24px">${esc(r.buttonText)}</a></p>`
    : "";
  const sign = `<p style="margin:16px 0 0;color:#8FB7C4">Il team Akire88<br><a href="${SITE_URL}" style="color:#5EEAD4">${SITE_URL.replace(/^https?:\/\//, "")}</a></p>`;
  const q = quote && quote.text.trim()
    ? `<div style="margin:24px 0 0;padding:14px 16px;border-left:3px solid #2E5468;color:#8FB7C4;font-size:13px;line-height:1.55"><p style="margin:0 0 8px">Il ${esc(quote.date)}, ${esc(quote.from)} ha scritto:</p><p style="margin:0;white-space:pre-line">${esc(quote.text.trim().slice(0, 4000))}</p></div>`
    : "";
  const html = mailLayout(r.title ? esc(r.title) : "", paras + button + sign + q);
  const text = `${r.title ? r.title + "\n\n" : ""}${r.body.trim()}\n${
    r.buttonText && isHttpUrl(r.buttonUrl) ? `\n${r.buttonText}: ${r.buttonUrl}\n` : ""
  }\nIl team Akire88\n${SITE_URL}${
    quote ? `\n\nIl ${quote.date}, ${quote.from} ha scritto:\n` + quote.text.trim().slice(0, 4000).split("\n").map((l) => "> " + l).join("\n") : ""
  }`;
  return { html, text };
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
