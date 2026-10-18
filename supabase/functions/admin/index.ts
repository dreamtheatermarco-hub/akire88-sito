// Edge Function "admin": pannello di gestione newsletter.
// Accesso con i segreti ADMIN_USER e ADMIN_PASSWORD; dopo il login il browser riceve un
// token firmato valido 8 ore, così la password non viaggia a ogni richiesta.
import {
  clean, corsHeaders, db, isEmail, isHttpUrl, json, makeToken, makeTransport, newsletterEmail, NOTIFY_TO,
  type NewsletterInput, safeEqual, sendMail, SESSION_HOURS, SITE_URL, validToken,
} from "../_shared/common.ts";

function readNewsletter(b: Record<string, unknown>): NewsletterInput | string {
  const n: NewsletterInput = {
    subject: clean(b.subject, 200),
    title: clean(b.title, 200),
    body: typeof b.body === "string" ? b.body.slice(0, 20000) : "",
    buttonText: clean(b.buttonText, 80) || undefined,
    buttonUrl: clean(b.buttonUrl, 600) || undefined,
  };
  if (!n.subject) return "Manca l'oggetto.";
  if (!n.title) return "Manca il titolo.";
  if (!n.body.trim()) return "Manca il testo.";
  if (n.buttonText && !isHttpUrl(n.buttonUrl)) return "Il link del pulsante deve iniziare con https://";
  return n;
}

const unsubUrl = (token: string) => `${SITE_URL}/newsletter.html?azione=disiscrivi&token=${token}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "method" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { ok: false, error: "bad-json" }, 400); }
  const action = String(b.action ?? "");

  // ---- Login ----
  if (action === "login") {
    const u = Deno.env.get("ADMIN_USER"), p = Deno.env.get("ADMIN_PASSWORD");
    if (!u || !p) return json(req, { ok: false, error: "Segreti ADMIN_USER / ADMIN_PASSWORD non impostati." }, 500);
    const ok = safeEqual(String(b.user ?? ""), u) && safeEqual(String(b.password ?? ""), p);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 1500)); // rallenta i tentativi
      return json(req, { ok: false, error: "Utente o password non corretti." }, 401);
    }
    return json(req, { ok: true, token: await makeToken(), hours: SESSION_HOURS, notifyTo: NOTIFY_TO });
  }

  if (!(await validToken(b.token))) return json(req, { ok: false, error: "session" }, 401);
  const supabase = db();

  // ---- Iscritti ----
  if (action === "list") {
    const { data, error } = await supabase.from("newsletter_subscribers")
      .select("id, email, stato, created_at, confirmed_at, unsubscribed_at")
      .order("created_at", { ascending: false }).limit(5000);
    if (error) return json(req, { ok: false, error: "db" }, 500);
    const { data: camps } = await supabase.from("newsletter_campaigns")
      .select("id, created_at, subject, recipients, sent, failed")
      .order("created_at", { ascending: false }).limit(20);
    return json(req, { ok: true, subscribers: data, campaigns: camps ?? [] });
  }

  if (action === "remove") {
    const id = clean(b.id, 64);
    const { error } = await supabase.from("newsletter_subscribers").delete().eq("id", id);
    if (error) return json(req, { ok: false, error: "db" }, 500);
    return json(req, { ok: true });
  }

  // ---- Newsletter ----
  if (action === "preview" || action === "test" || action === "send") {
    const n = readNewsletter(b);
    if (typeof n === "string") return json(req, { ok: false, error: n }, 400);

    if (action === "preview") {
      return json(req, { ok: true, html: newsletterEmail(n, unsubUrl("00000000-0000-0000-0000-000000000000")).html });
    }

    if (action === "test") {
      const to = clean(b.to, 254) || NOTIFY_TO;
      if (!isEmail(to)) return json(req, { ok: false, error: "Indirizzo di prova non valido." }, 400);
      const mail = newsletterEmail(n, unsubUrl("00000000-0000-0000-0000-000000000000"));
      try {
        await sendMail({ to, subject: `[PROVA] ${n.subject}`, ...mail });
      } catch (e) {
        console.error("test", e);
        return json(req, { ok: false, error: "Invio non riuscito: controlla i segreti SMTP." }, 502);
      }
      return json(req, { ok: true, to });
    }

    // send: a tutti gli iscritti confermati, una email per persona con il suo link di disiscrizione
    const { data: subs, error } = await supabase.from("newsletter_subscribers")
      .select("email, token").eq("stato", "confermato");
    if (error) return json(req, { ok: false, error: "db" }, 500);
    if (!subs?.length) return json(req, { ok: false, error: "Non ci sono iscritti confermati." }, 400);

    const transporter = makeTransport(true);
    let sent = 0;
    const failed: string[] = [];
    for (const s of subs) {
      const u = unsubUrl(s.token);
      const mail = newsletterEmail(n, u);
      try {
        await sendMail({
          to: s.email, subject: n.subject, ...mail,
          headers: { "List-Unsubscribe": `<${u}>` },
        }, transporter);
        sent++;
      } catch (e) {
        console.error("send", s.email, e);
        failed.push(s.email);
      }
    }
    transporter.close();

    await supabase.from("newsletter_campaigns").insert({
      subject: n.subject, title: n.title, body: n.body,
      button_text: n.buttonText ?? null, button_url: n.buttonUrl ?? null,
      recipients: subs.length, sent, failed: failed.length, failed_emails: failed,
    });
    return json(req, { ok: true, recipients: subs.length, sent, failed });
  }

  return json(req, { ok: false, error: "action" }, 400);
});
