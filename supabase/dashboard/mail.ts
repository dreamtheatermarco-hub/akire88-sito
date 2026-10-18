// Edge Function "mail": legge la casella assistenza@akire88.it via IMAP e invia risposte con la grafica Akire88.
// Usa lo stesso accesso del pannello admin (token ottenuto con il login).
// Versione in un unico file, da incollare nell'editor di Supabase.
import { ImapFlow } from "npm:imapflow@1.7.8";
import PostalMime from "npm:postal-mime@2.7.6";
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
const MAX_LIST = 80;

function imap() {
  return new ImapFlow({
    host: Deno.env.get("IMAP_HOST") ?? "pop.securemail.pro",
    port: Number(Deno.env.get("IMAP_PORT") ?? "993"),
    secure: (Deno.env.get("IMAP_PORT") ?? "993") === "993",
    auth: {
      user: Deno.env.get("IMAP_USER") ?? Deno.env.get("SMTP_USER") ?? "",
      pass: Deno.env.get("IMAP_PASS") ?? Deno.env.get("SMTP_PASS") ?? "",
    },
    logger: false,
    socketTimeout: 30_000,
  });
}

async function withInbox<T>(fn: (c: ImapFlow) => Promise<T>, readOnly = false): Promise<T> {
  const client = imap();
  await client.connect();
  const lock = await client.getMailboxLock("INBOX", { readOnly });
  try {
    return await fn(client);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

const fmtDate = (d?: Date | string) =>
  d ? new Date(d).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }) : "";

function readReply(b: Record<string, unknown>): ReplyInput | string {
  const r: ReplyInput = {
    title: clean(b.title, 200) || undefined,
    body: typeof b.body === "string" ? b.body.slice(0, 20000) : "",
    buttonText: clean(b.buttonText, 80) || undefined,
    buttonUrl: clean(b.buttonUrl, 600) || undefined,
  };
  if (!r.body.trim()) return "Scrivi il testo della risposta.";
  if (r.buttonText && !isHttpUrl(r.buttonUrl)) return "Il link del pulsante deve iniziare con https://";
  return r;
}

type Original = {
  uid: number; subject: string; fromName: string; fromAddr: string; replyTo: string;
  messageId?: string; references?: string; date: string; text: string; html?: string;
  to: string; attachments: { filename: string; size: number }[];
};

async function loadOriginal(c: ImapFlow, uid: number): Promise<Original | null> {
  const msg = await c.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
  if (!msg || !msg.source) return null;
  const p = await PostalMime.parse(msg.source);
  const text = p.text ?? (p.html ? p.html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : "");
  return {
    uid,
    subject: p.subject ?? "(senza oggetto)",
    fromName: p.from?.name ?? "",
    fromAddr: p.from?.address ?? "",
    replyTo: p.replyTo?.[0]?.address ?? p.from?.address ?? "",
    messageId: p.messageId,
    references: (p.headers.find((h) => h.key === "references")?.value) ?? undefined,
    date: fmtDate(p.date),
    text: text.trim(),
    html: p.html,
    to: (p.to ?? []).map((t) => t.address).filter(Boolean).join(", "),
    attachments: (p.attachments ?? []).map((a) => ({
      filename: a.filename ?? "allegato",
      size: typeof a.content === "string" ? a.content.length : (a.content as ArrayBuffer).byteLength,
    })),
  };
}

// L'HTML ricevuto si mostra in un iframe senza script; qui togliamo anche script e handler per sicurezza.
function safeHtml(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:">`;
  return `<!doctype html><html><head><meta charset="utf-8">${csp}<base target="_blank"><style>body{font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#14222b;background:#fff;margin:16px;word-break:break-word}img{max-width:100%;height:auto}</style></head><body>${cleaned}</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "method" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { ok: false, error: "bad-json" }, 400); }
  if (!(await validToken(b.token))) return json(req, { ok: false, error: "session" }, 401);
  const action = String(b.action ?? "");

  try {
    // ---- Elenco messaggi ----
    if (action === "list") {
      const out = await withInbox(async (c) => {
        const uids = ((await c.search({ all: true }, { uid: true })) || []) as number[];
        const last = uids.sort((x, y) => x - y).slice(-MAX_LIST);
        const items: Record<string, unknown>[] = [];
        if (last.length) {
          for await (const m of c.fetch(last.join(","), { envelope: true, flags: true, internalDate: true, uid: true }, { uid: true })) {
            const f = m.envelope?.from?.[0];
            items.push({
              uid: m.uid,
              fromName: f?.name ?? "",
              fromAddr: f?.address ?? "",
              subject: m.envelope?.subject ?? "(senza oggetto)",
              date: new Date(m.internalDate ?? m.envelope?.date ?? Date.now()).toISOString(),
              seen: m.flags?.has("\\Seen") ?? false,
              answered: m.flags?.has("\\Answered") ?? false,
            });
          }
        }
        items.sort((x, y) => new Date(String(y.date)).getTime() - new Date(String(x.date)).getTime());
        return items;
      }, true);
      return json(req, { ok: true, messages: out });
    }

    // ---- Lettura (segna come letto) ----
    if (action === "read") {
      const uid = Number(b.uid);
      if (!uid) return json(req, { ok: false, error: "invalid" }, 400);
      const msg = await withInbox(async (c) => {
        const o = await loadOriginal(c, uid);
        if (o) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        return o;
      });
      if (!msg) return json(req, { ok: false, error: "Messaggio non trovato." }, 404);
      return json(req, {
        ok: true,
        message: {
          uid: msg.uid, subject: msg.subject, fromName: msg.fromName, fromAddr: msg.fromAddr,
          replyTo: msg.replyTo, to: msg.to, date: msg.date, text: msg.text,
          html: msg.html ? safeHtml(msg.html) : null, attachments: msg.attachments,
        },
      });
    }

    if (action === "unread") {
      const uid = Number(b.uid);
      await withInbox((c) => c.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true }));
      return json(req, { ok: true });
    }

    // ---- Anteprima e invio risposta ----
    if (action === "preview" || action === "reply") {
      const r = readReply(b);
      if (typeof r === "string") return json(req, { ok: false, error: r }, 400);
      const uid = Number(b.uid);
      const includeQuote = b.quote !== false;

      if (action === "preview") {
        const q = includeQuote && b.quoteText
          ? { from: clean(b.quoteFrom, 200), date: clean(b.quoteDate, 60), text: String(b.quoteText).slice(0, 4000) }
          : undefined;
        return json(req, { ok: true, html: replyEmail(r, q).html });
      }

      const result = await withInbox(async (c) => {
        const o = await loadOriginal(c, uid);
        if (!o) return { error: "Messaggio non trovato." };
        const to = isEmail(b.to) ? String(b.to) : o.replyTo;
        if (!isEmail(to)) return { error: "Indirizzo del destinatario non valido." };
        const subject = /^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`;
        const mail = replyEmail(r, includeQuote ? { from: o.fromName || o.fromAddr, date: o.date, text: o.text } : undefined);
        const headers: Record<string, string> = {};
        if (o.messageId) {
          headers["In-Reply-To"] = o.messageId;
          headers["References"] = [o.references, o.messageId].filter(Boolean).join(" ");
        }
        await sendMail({ to, subject, ...mail, headers });
        await c.messageFlagsAdd(String(uid), ["\\Answered", "\\Seen"], { uid: true });

        // Copia nella cartella "Inviata" della casella, se esiste.
        try {
          const boxes = await c.list();
          const sent = boxes.find((x) => x.specialUse === "\\Sent") ??
            boxes.find((x) => /^(inbox\.)?(sent|inviata|posta inviata|sent items|sent messages)$/i.test(x.path));
          if (sent) {
            const from = Deno.env.get("MAIL_FROM") ?? Deno.env.get("SMTP_USER") ?? "";
            const raw = [
              `From: "Akire88" <${from}>`, `To: ${to}`, `Subject: ${subject}`,
              `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
              ...(o.messageId ? [`In-Reply-To: ${o.messageId}`] : []),
              "Content-Type: text/html; charset=utf-8", "", mail.html,
            ].join("\r\n");
            await c.append(sent.path, raw, ["\\Seen"]);
          }
        } catch (e) { console.error("append sent", e); }
        return { to, subject };
      });
      if ("error" in result) return json(req, { ok: false, error: result.error }, 400);
      return json(req, { ok: true, ...result });
    }

    return json(req, { ok: false, error: "action" }, 400);
  } catch (e) {
    console.error("mail", e);
    const m = String((e as Error)?.message ?? e);
    const hint = /auth|login|credential/i.test(m)
      ? "Accesso alla casella non riuscito: controlla IMAP_HOST, utente e password."
      : /ENOTFOUND|getaddrinfo|connect|timeout|ECONN/i.test(m)
      ? "Server IMAP non raggiungibile: controlla IMAP_HOST e IMAP_PORT."
      : "Operazione sulla posta non riuscita. Riprova tra poco.";
    return json(req, { ok: false, error: hint }, 502);
  }
});
