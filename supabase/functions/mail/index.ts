// Edge Function "mail": legge la casella assistenza@akire88.it via IMAP e invia risposte con la grafica Akire88.
// Usa lo stesso accesso del pannello admin (token ottenuto con il login).
import { ImapFlow } from "npm:imapflow@1.7.8";
import {
  clean, corsHeaders, isEmail, isHttpUrl, json, replyEmail, type ReplyInput, sendMail, validToken,
} from "../_shared/common.ts";

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

// deno-lint-ignore no-explicit-any
type Node = any;

// Percorre la struttura MIME: trova la parte testo, la parte HTML e gli allegati, senza scaricarli.
function walk(n: Node, out: { text?: Node; html?: Node; att: Node[] }) {
  if (!n) return;
  if (n.childNodes?.length) { for (const ch of n.childNodes) walk(ch, out); return; }
  const type = String(n.type ?? "").toLowerCase();
  const name = n.dispositionParameters?.filename ?? n.parameters?.name;
  const isAtt = n.disposition === "attachment" || (!!name && !type.startsWith("text/"));
  if (isAtt) { out.att.push(n); return; }
  if (type === "text/plain" && !out.text) out.text = n;
  else if (type === "text/html" && !out.html) out.html = n;
}

const MAX_PART = 400_000; // caratteri: oltre, il testo viene troncato

async function downloadPart(c: ImapFlow, uid: number, n: Node): Promise<string> {
  const part = n.part ?? "1";
  const { content } = await c.download(String(uid), part, { uid: true, maxBytes: MAX_PART });
  const dec = new TextDecoder();
  let out = "";
  for await (const chunk of content as AsyncIterable<Uint8Array | string>) {
    out += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
    if (out.length > MAX_PART) break;
  }
  return out;
}

async function loadOriginal(c: ImapFlow, uid: number): Promise<Original | null> {
  const msg = await c.fetchOne(String(uid), { envelope: true, bodyStructure: true, headers: ["references"], uid: true }, { uid: true });
  if (!msg || !msg.envelope) return null;
  const env = msg.envelope;
  const parts: { text?: Node; html?: Node; att: Node[] } = { att: [] };
  walk(msg.bodyStructure, parts);
  const html = parts.html ? await downloadPart(c, uid, parts.html) : undefined;
  let text = parts.text ? await downloadPart(c, uid, parts.text) : "";
  if (!text && html) {
    text = html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n");
  }
  const refs = msg.headers ? new TextDecoder().decode(msg.headers).replace(/^references:\s*/i, "").replace(/\s+/g, " ").trim() : "";
  const from = env.from?.[0];
  return {
    uid,
    subject: env.subject ?? "(senza oggetto)",
    fromName: from?.name ?? "",
    fromAddr: from?.address ?? "",
    replyTo: env.replyTo?.[0]?.address ?? from?.address ?? "",
    messageId: env.messageId,
    references: refs || undefined,
    date: fmtDate(env.date),
    text: text.trim(),
    html,
    to: (env.to ?? []).map((t: { address?: string }) => t.address).filter(Boolean).join(", "),
    attachments: parts.att.map((n: Node) => ({
      filename: n.dispositionParameters?.filename ?? n.parameters?.name ?? "allegato",
      size: Number(n.size ?? 0),
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
