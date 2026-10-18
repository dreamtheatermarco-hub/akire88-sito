// Edge Function "contact": salva la richiesta del modulo e avvisa assistenza@akire88.it.
import { clean, corsHeaders, db, esc, isEmail, json, mailLayout, NOTIFY_TO, sendMail } from "../_shared/common.ts";

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
