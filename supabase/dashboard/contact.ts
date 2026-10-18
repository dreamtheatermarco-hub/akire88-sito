// Edge Function "contact": salva la richiesta del modulo e avvisa assistenza@akire88.it.
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
<tr><td style="padding:8px 32px 0;font-size:20px;font-weight:bold;color:#E6FFFA">${title}</td></tr>
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

function inline(s: string): string {
  // **grassetto** e link https://… cliccabili, dopo l'escape.
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#E6FFFA">$1</strong>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#5EEAD4">$1</a>');
}

function newsletterEmail(n: NewsletterInput, unsubscribeUrl: string) {
  const paras = n.body.trim().split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 16px">${inline(p).replace(/\n/g, "<br>")}</p>`
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

// ---------------------------------------------------------------
const TIPI = new Set([
  "Informazioni generali", "App iOS", "App Android", "App iOS e Android",
  "App per il mio software o sito", "App per il mio settore", "App con assistente IA",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "method" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { ok: false, error: "bad-json" }, 400); }

  // Trappola anti-spam: il campo "website" è invisibile alle persone.
  if (clean(b.website, 200)) return json(req, { ok: true });

  const row = {
    tipo: TIPI.has(String(b.tipo)) ? String(b.tipo) : "Informazioni generali",
    nome: clean(b.nome, 120),
    email: clean(b.email, 254).toLowerCase(),
    azienda: clean(b.azienda, 160) || null,
    telefono: clean(b.telefono, 40) || null,
    messaggio: clean(b.messaggio, 5000),
    privacy_ok: b.privacy === true,
  };
  if (!row.nome || !row.messaggio || !isEmail(row.email) || !row.privacy_ok) {
    return json(req, { ok: false, error: "invalid" }, 400);
  }

  const supabase = db();
  const { data, error } = await supabase.from("contact_requests").insert(row).select("id").single();
  if (error) {
    console.error("insert", error);
    return json(req, { ok: false, error: "db" }, 500);
  }

  // La richiesta è salvata: se l'email fallisce la ritrovi comunque nel pannello.
  try {
    const righe = [
      ["Tipo di richiesta", row.tipo], ["Nome", row.nome], ["Email", row.email],
      ["Azienda", row.azienda ?? "—"], ["Telefono", row.telefono ?? "—"],
    ];
    const html = mailLayout(
      `Nuova richiesta: ${esc(row.tipo)}`,
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px">${
        righe.map(([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#8FB7C4;white-space:nowrap">${k}</td><td style="padding:6px 0;color:#E6FFFA">${esc(String(v))}</td></tr>`
        ).join("")
      }</table><p style="margin:20px 0 6px;color:#8FB7C4">Messaggio</p><p style="margin:0;white-space:pre-line;color:#E6FFFA">${esc(row.messaggio)}</p>`,
    );
    await sendMail({
      to: NOTIFY_TO,
      replyTo: row.email,
      subject: `[Sito] ${row.tipo} – ${row.nome}`,
      text: righe.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nMessaggio:\n${row.messaggio}`,
      html,
    });
    await supabase.from("contact_requests").update({ email_sent: true }).eq("id", data.id);
  } catch (e) {
    console.error("mail", e);
  }

  // Conferma automatica a chi ha scritto.
  try {
    const nome = row.nome.split(/\s+/)[0];
    await sendMail({
      to: row.email,
      replyTo: NOTIFY_TO,
      subject: "Abbiamo ricevuto la tua richiesta – Akire88",
      text: `Ciao ${nome},\n\ngrazie per averci scritto! Abbiamo ricevuto la tua richiesta (${row.tipo}) e ti risponderemo al più presto.\n\nEcco cosa ci hai scritto:\n${row.messaggio}\n\nSe vuoi aggiungere qualcosa, rispondi pure a questa email.\n\nAkire88\n${NOTIFY_TO}`,
      html: mailLayout(
        `Grazie, ${esc(nome)}!`,
        `<p style="margin:0 0 16px">Abbiamo ricevuto la tua richiesta <strong style="color:#E6FFFA">${esc(row.tipo)}</strong> e ti risponderemo al più presto.</p>
<p style="margin:0 0 6px;color:#8FB7C4">Ecco cosa ci hai scritto</p>
<p style="margin:0 0 20px;padding:14px 16px;border-radius:12px;background:#081C28;white-space:pre-line;color:#E6FFFA">${esc(row.messaggio)}</p>
<p style="margin:0">Se vuoi aggiungere qualcosa, rispondi pure a questa email.</p>
<p style="margin:16px 0 0;color:#8FB7C4">Il team Akire88</p>`,
      ),
    });
  } catch (e) {
    console.error("ack", e);
  }

  return json(req, { ok: true });
});
