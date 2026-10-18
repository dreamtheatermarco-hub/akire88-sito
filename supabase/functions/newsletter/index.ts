// Edge Function "newsletter": iscrizione con doppia conferma, conferma e disiscrizione.
import { clean, corsHeaders, db, isEmail, json, mailLayout, sendMail, SITE_URL } from "../_shared/common.ts";

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
