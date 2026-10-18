// Utilità condivise dalle Edge Functions del sito Akire88.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.15";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://www.akire88.it,https://akire88.it").split(",").map((s) => s.trim());

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);

export const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.trim().slice(0, max) : "";

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Invio email tramite la casella di Register (SMTP con SSL).
export function makeTransport(pool = false) {
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
export async function sendMail(opts: MailOpts, transporter?: any) {
  const t = transporter ?? makeTransport();
  await t.sendMail({
    from: `"Akire88" <${Deno.env.get("MAIL_FROM") ?? Deno.env.get("SMTP_USER")}>`,
    ...opts,
  });
}

export const SITE_URL = Deno.env.get("SITE_URL") ?? "https://www.akire88.it";
export const NOTIFY_TO = Deno.env.get("NOTIFY_TO") ?? "assistenza@akire88.it";

// Cornice grafica delle email
export function mailLayout(title: string, bodyHtml: string, footerHtml = ""): string {
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
export type NewsletterInput = {
  subject: string; title: string; body: string; buttonText?: string; buttonUrl?: string;
};

export function isHttpUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 600) return false;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}

export function inlineFormat(s: string): string {
  // **grassetto** e link https://… cliccabili, dopo l'escape.
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#E6FFFA">$1</strong>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#5EEAD4">$1</a>');
}

export function newsletterEmail(n: NewsletterInput, unsubscribeUrl: string) {
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
export const SESSION_HOURS = Number(Deno.env.get("ADMIN_SESSION_HOURS") ?? "8");
const enc = new TextEncoder();

export function safeEqual(a: string, b: string): boolean {
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

export async function makeToken(): Promise<string> {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  return `${exp}.${await hmac(`admin:${exp}`)}`;
}

export async function validToken(t: unknown): Promise<boolean> {
  if (typeof t !== "string") return false;
  const [expStr, sig] = t.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  return safeEqual(sig, await hmac(`admin:${exp}`));
}

// Risposta a un'email ricevuta: stessa grafica, testo, pulsante facoltativo e messaggio originale citato.
export type ReplyInput = { title?: string; body: string; buttonText?: string; buttonUrl?: string };

export function replyEmail(r: ReplyInput, quote?: { from: string; date: string; text: string }) {
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
