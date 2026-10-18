/* Akire88 · pannello admin newsletter */
(function () {
  'use strict';
  var CFG = window.AKIRE88 || {};
  var KEY = 'k88_admin_token';
  var DRAFT = 'k88_admin_draft';
  var token = null, notifyTo = 'assistenza@akire88.it', subs = [], removing = null;

  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function lstore(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lload(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function fmt(d) { return d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function show(el, on) { el.hidden = !on; }
  function msg(el, text) { el.textContent = text; el.hidden = !text; }

  function api(payload, fn) {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return Promise.reject(new Error('Configurazione Supabase mancante.'));
    if (token) payload.token = token;
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/' + (fn || 'admin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + CFG.supabaseAnonKey },
      body: JSON.stringify(payload)
    }).catch(function () {
      throw new Error('Il server non ha risposto. Riprova tra poco; se succede ancora, apri su Supabase Edge Functions → ' + (fn || 'admin') + ' → Logs.');
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (d.error === 'session') { logout(); throw new Error('Sessione scaduta: accedi di nuovo.'); }
        if (!r.ok || d.ok === false) throw new Error(d.error && d.error.length > 12 ? d.error : 'Operazione non riuscita. Riprova.');
        return d;
      });
    });
  }

  /* ---------- Login ---------- */
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = this.querySelector('.k-err'), btn = this.querySelector('button');
    msg(err, ''); btn.disabled = true; btn.textContent = 'Accesso…';
    api({ action: 'login', user: $('l-user').value.trim(), password: $('l-pass').value })
      .then(function (d) {
        token = d.token; notifyTo = d.notifyTo || notifyTo;
        store(KEY, token); store('k88_notify', notifyTo);
        $('l-pass').value = '';
        enter();
      })
      .catch(function (x) { msg(err, x.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Accedi'; });
  });

  function enter() {
    show($('login'), false); show($('app'), true);
    if (!$('n-test').value) $('n-test').value = notifyTo;
    refresh();
    loadMail();
  }
  function logout() {
    token = null; store(KEY, null);
    show($('app'), false); show($('login'), true);
    $('l-user').focus();
  }
  $('logout').addEventListener('click', logout);

  /* ---------- Tabs ---------- */
  document.querySelectorAll('.a-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.a-tab').forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
      ['posta', 'iscritti', 'scrivi', 'inviate'].forEach(function (k) { show($('tab-' + k), k === t.dataset.tab); });
      if (t.dataset.tab === 'scrivi') schedulePreview(0);
    });
  });

  /* ---------- Iscritti ---------- */
  var LABEL = { confermato: 'Confermato', in_attesa: 'In attesa', disiscritto: 'Disiscritto' };
  function refresh() {
    return api({ action: 'list' }).then(function (d) {
      subs = d.subscribers || [];
      $('st-conf').textContent = subs.filter(function (s) { return s.stato === 'confermato'; }).length;
      $('st-att').textContent = subs.filter(function (s) { return s.stato === 'in_attesa'; }).length;
      $('st-dis').textContent = subs.filter(function (s) { return s.stato === 'disiscritto'; }).length;
      renderSubs(); renderCamps(d.campaigns || []); updateSendLabel();
    }).catch(function (x) { alertBar(x.message); });
  }
  function renderSubs() {
    var q = $('f-q').value.trim().toLowerCase(), st = $('f-st').value, tb = $('subs');
    tb.textContent = '';
    var list = subs.filter(function (s) { return (!st || s.stato === st) && (!q || s.email.indexOf(q) !== -1); });
    list.forEach(function (s) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td'); td1.textContent = s.email;
      var td2 = document.createElement('td'); var pill = document.createElement('span'); pill.className = 'a-pill ' + s.stato; pill.textContent = LABEL[s.stato] || s.stato; td2.appendChild(pill);
      var td3 = document.createElement('td'); td3.textContent = fmt(s.created_at);
      var td4 = document.createElement('td'); td4.textContent = fmt(s.confirmed_at);
      var td5 = document.createElement('td'); var b = document.createElement('button');
      b.className = 'a-btn a-btn-sm ' + (removing === s.id ? 'a-btn-danger' : 'a-btn-ghost');
      b.textContent = removing === s.id ? 'Conferma rimozione' : 'Rimuovi';
      b.setAttribute('aria-label', (removing === s.id ? 'Conferma rimozione di ' : 'Rimuovi ') + s.email);
      b.addEventListener('click', function () {
        if (removing !== s.id) { removing = s.id; renderSubs(); return; }
        b.disabled = true;
        api({ action: 'remove', id: s.id }).then(function () { removing = null; return refresh(); }).catch(function (x) { alertBar(x.message); b.disabled = false; });
      });
      td5.appendChild(b);
      [td1, td2, td3, td4, td5].forEach(function (td) { tr.appendChild(td); });
      tb.appendChild(tr);
    });
    show($('subs-empty'), !list.length);
  }
  $('f-q').addEventListener('input', renderSubs);
  $('f-st').addEventListener('change', renderSubs);
  $('refresh').addEventListener('click', refresh);
  $('export').addEventListener('click', function () {
    var rows = [['email', 'stato', 'iscritto_il', 'confermato_il']].concat(subs.map(function (s) {
      return [s.email, s.stato, s.created_at || '', s.confirmed_at || ''];
    }));
    var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'iscritti-akire88-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });

  function renderCamps(c) {
    var tb = $('camps'); tb.textContent = '';
    c.forEach(function (x) {
      var tr = document.createElement('tr');
      [fmt(x.created_at), x.subject, x.sent + ' / ' + x.recipients, String(x.failed)].forEach(function (v) {
        var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    show($('camps-empty'), !c.length);
  }

  /* ---------- Newsletter ---------- */
  var F = ['n-subject', 'n-title', 'n-body', 'n-btext', 'n-burl'];
  function data() {
    return { subject: $('n-subject').value.trim(), title: $('n-title').value.trim(), body: $('n-body').value,
      buttonText: $('n-btext').value.trim(), buttonUrl: $('n-burl').value.trim() };
  }
  function confirmed() { return subs.filter(function (s) { return s.stato === 'confermato'; }).length; }
  function updateSendLabel() {
    var n = confirmed();
    $('btn-send').textContent = 'Invia a tutti gli iscritti confermati (' + n + ')';
    $('btn-send').disabled = n === 0;
  }
  function alertBar(t) { msg($('nl-ok'), ''); msg($('nl-err'), t); }
  function okBar(t) { msg($('nl-err'), ''); msg($('nl-ok'), t); }

  var timer = null;
  function schedulePreview(ms) {
    clearTimeout(timer);
    timer = setTimeout(preview, ms === undefined ? 700 : ms);
  }
  function preview() {
    var d = data();
    if (!d.subject && !d.title && !d.body.trim()) {
      $('preview').srcdoc = '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#081C28;color:#8FB7C4;font-family:Helvetica,Arial,sans-serif">Scrivi oggetto, titolo e testo per vedere l\'anteprima</body>';
      return;
    }
    $('prev-state').textContent = 'aggiorno…';
    api(Object.assign({ action: 'preview' }, d, { subject: d.subject || '—', title: d.title || '—', body: d.body.trim() ? d.body : '…' }))
      .then(function (r) { $('preview').srcdoc = r.html; $('prev-state').textContent = ''; msg($('nl-err'), ''); })
      .catch(function (x) { $('prev-state').textContent = ''; alertBar(x.message); });
  }
  F.forEach(function (id) {
    $(id).addEventListener('input', function () {
      schedulePreview();
      lstore(DRAFT, JSON.stringify(data()));
      $('draft-note').textContent = 'Bozza salvata su questo computer';
      show($('confirm'), false);
    });
  });
  (function restoreDraft() {
    var raw = lload(DRAFT); if (!raw) return;
    try {
      var d = JSON.parse(raw);
      $('n-subject').value = d.subject || ''; $('n-title').value = d.title || ''; $('n-body').value = d.body || '';
      $('n-btext').value = d.buttonText || ''; $('n-burl').value = d.buttonUrl || '';
      $('draft-note').textContent = 'Bozza ripristinata';
    } catch (e) {}
  })();

  $('btn-test').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Invio…';
    api(Object.assign({ action: 'test', to: $('n-test').value.trim() }, data()))
      .then(function (r) { okBar('Prova inviata a ' + r.to + '. Controlla la casella (anche lo spam).'); })
      .catch(function (x) { alertBar(x.message); })
      .then(function () { b.disabled = false; b.textContent = 'Invia prova'; });
  });

  $('btn-send').addEventListener('click', function () {
    var d = data();
    if (!d.subject || !d.title || !d.body.trim()) { alertBar('Compila oggetto, titolo e testo prima di inviare.'); return; }
    $('confirm-text').textContent = 'Stai per inviare «' + d.subject + '» a ' + confirmed() + ' iscritti confermati. L\'invio non si può annullare.';
    show($('confirm'), true);
    $('btn-go').focus();
  });
  $('btn-cancel').addEventListener('click', function () { show($('confirm'), false); });
  $('btn-go').addEventListener('click', function () {
    var b = this; b.disabled = true; $('btn-cancel').disabled = true; b.textContent = 'Invio in corso…';
    msg($('nl-err'), ''); okBar('Invio in corso: non chiudere la pagina.');
    api(Object.assign({ action: 'send' }, data()))
      .then(function (r) {
        show($('confirm'), false);
        okBar('Newsletter inviata a ' + r.sent + ' iscritti su ' + r.recipients + '.' + (r.failed.length ? ' Non consegnata a: ' + r.failed.join(', ') + '.' : ''));
        refresh();
      })
      .catch(function (x) { alertBar(x.message); })
      .then(function () { b.disabled = false; $('btn-cancel').disabled = false; b.textContent = 'Sì, invia ora'; });
  });

  /* ---------- Posta ---------- */
  var mails = [], mfilter = 'nuove', cur = null;
  // Le richieste alla casella partono una alla volta (Register limita le connessioni contemporanee)
  // e, se il server non risponde, si riprovano da sole fino a 2 volte. L'invio di una risposta non viene mai ripetuto.
  var mqueue = Promise.resolve();
  var SAFE = { list: 1, read: 1, preview: 1, unread: 1, resolve: 1, replies: 1 };
  function mapi(p) {
    var tries = SAFE[p.action] ? 3 : 1;
    function attempt(n) {
      return api(Object.assign({}, p), 'mail').catch(function (e) {
        var network = /non ha risposto/.test(e.message);
        if (network && n < tries) return new Promise(function (r) { setTimeout(r, 900 * n); }).then(function () { return attempt(n + 1); });
        throw e;
      });
    }
    var job = mqueue.then(function () { return attempt(1); });
    mqueue = job.catch(function () {});
    return job;
  }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shortDate(d) {
    var x = new Date(d), now = new Date();
    return x.toDateString() === now.toDateString()
      ? x.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : x.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  }

  function loadMail() {
    msg($('m-err'), ''); show($('m-loading'), !mails.length);
    return mapi({ action: 'list' }).then(function (d) {
      mails = d.messages || []; renderMail();
    }).catch(function (x) { msg($('m-err'), x.message); })
      .then(function () { show($('m-loading'), false); });
  }

  function renderMail() {
    var nNew = mails.filter(function (m) { return !m.answered && !m.resolved; }).length;
    var nUnread = mails.filter(function (m) { return !m.seen; }).length;
    $('cnt-nuove').textContent = nNew ? '(' + nNew + ')' : '';
    $('cnt-risp').textContent = '';
    var badge = $('badge-new'); badge.textContent = nUnread; show(badge, nUnread > 0);
    var list = mails.filter(function (m) {
      if (mfilter === 'tutte') return true;
      if (mfilter === 'nuove') return !m.answered && !m.resolved;
      if (mfilter === 'risolte') return m.resolved;
      return m.answered && !m.resolved;
    });
    var ul = $('mlist'); ul.textContent = '';
    list.forEach(function (m) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'a-mitem' + (m.seen ? '' : ' unread');
      if (cur && cur.uid === m.uid) b.setAttribute('aria-current', 'true');
      b.innerHTML = '<span class="a-dot" aria-hidden="true"></span><span class="a-mfrom"></span><span class="a-mdate"></span><span class="a-msubj"></span>' + (m.resolved ? '<span class="a-mtag res">Risolta</span>' : m.answered ? '<span class="a-mtag">Risposta inviata</span>' : '');
      b.querySelector('.a-mfrom').textContent = m.fromName || m.fromAddr;
      b.querySelector('.a-mdate').textContent = shortDate(m.date);
      b.querySelector('.a-msubj').textContent = m.subject;
      b.setAttribute('aria-label', (m.seen ? '' : 'Non letta. ') + (m.fromName || m.fromAddr) + ': ' + m.subject);
      b.addEventListener('click', function () { openMail(m.uid); });
      li.appendChild(b); ul.appendChild(li);
    });
    show($('m-empty'), !list.length);
  }

  document.querySelectorAll('.a-segbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      mfilter = b.dataset.mf;
      document.querySelectorAll('.a-segbtn').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      renderMail();
    });
  });
  $('m-refresh').addEventListener('click', loadMail);

  function openMail(uid) {
    msg($('m-err'), '');
    show($('mv-placeholder'), false);
    $('mv-subject').textContent = 'Apro il messaggio…';
    show($('mv'), true);
    mapi({ action: 'read', uid: uid }).then(function (d) {
      cur = d.message;
      $('mv-subject').textContent = cur.subject;
      $('mv-from').textContent = cur.fromName || cur.fromAddr;
      $('mv-addr').textContent = cur.fromName ? '<' + cur.fromAddr + '>' : '';
      $('mv-date').textContent = cur.date;
      $('mv-to').textContent = cur.to;
      $('rp-to').textContent = cur.replyTo;
      var att = cur.attachments || [];
      msg($('mv-att'), att.length ? 'Allegati (da aprire nel programma di posta): ' + att.map(function (a) { return a.filename; }).join(', ') : '');
      $('mv-body').srcdoc = cur.html || ('<!doctype html><meta charset="utf-8"><body style="margin:16px;font:15px/1.55 Helvetica,Arial,sans-serif;color:#14222b;white-space:pre-wrap;word-break:break-word">' + esc(cur.text || '(messaggio vuoto)') + '</body>');
      ['rp-title', 'rp-body', 'rp-btext', 'rp-burl'].forEach(function (id) { $(id).value = ''; });
      msg($('rp-err'), ''); msg($('rp-ok'), ''); show($('rp-preview'), false); $('rp-prev').textContent = 'Mostra anteprima';
      mails.forEach(function (m) { if (m.uid === uid) m.seen = true; });
      renderMail(); syncResolveBtn(); setupReplies();
      if (window.innerWidth < 900) $('mview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (x) { show($('mv'), false); show($('mv-placeholder'), true); msg($('m-err'), x.message); });
  }

  function syncResolveBtn() {
    var m = cur && mails.filter(function (x) { return x.uid === cur.uid; })[0];
    var on = !!(m && m.resolved);
    $('mv-resolve').textContent = on ? 'Riapri' : 'Segna come risolta';
    $('mv-resolve').setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  $('mv-resolve').addEventListener('click', function () {
    if (!cur) return;
    var uid = cur.uid, b = this;
    var m = mails.filter(function (x) { return x.uid === uid; })[0];
    var on = !(m && m.resolved);
    b.disabled = true;
    mapi({ action: 'resolve', uid: uid, on: on }).then(function () {
      mails.forEach(function (x) { if (x.uid === uid) { x.resolved = on; if (on) x.seen = true; } });
      renderMail(); syncResolveBtn();
      msg($('rp-ok'), on ? 'Messaggio segnato come risolto: lo trovi in "Risolte".' : 'Messaggio riaperto: è di nuovo tra le "Nuove".');
      msg($('rp-err'), '');
    }).catch(function (x) { msg($('m-err'), x.message); })
      .then(function () { b.disabled = false; });
  });

  /* Risposta già inviata: sezione a scomparsa, caricata solo all'apertura */
  var repliesFor = null;
  function setupReplies() {
    var m = cur && mails.filter(function (x) { return x.uid === cur.uid; })[0];
    var d = $('mv-replies');
    d.open = false; repliesFor = null;
    $('mv-replies-body').textContent = '';
    $('mv-replies-hint').textContent = 'mostra';
    show(d, !!(m && m.answered));
  }
  $('mv-replies').addEventListener('toggle', function () {
    $('mv-replies-hint').textContent = this.open ? 'nascondi' : 'mostra';
    if (!this.open || !cur || repliesFor === cur.uid) return;
    var uid = cur.uid, box = $('mv-replies-body');
    repliesFor = uid;
    box.innerHTML = '<p class="a-note">Cerco la risposta nella cartella Inviata…</p>';
    mapi({ action: 'replies', uid: uid }).then(function (d) {
      if (!cur || cur.uid !== uid) return;
      box.textContent = '';
      var list = d.replies || [];
      if (!list.length) {
        var p = document.createElement('p'); p.className = 'a-note';
        p.textContent = d.note || 'Nessuna risposta trovata nella cartella Inviata (forse è stata inviata da un altro indirizzo o la copia non è stata salvata).';
        box.appendChild(p); return;
      }
      list.slice().reverse().forEach(function (r) {
        var meta = document.createElement('p'); meta.className = 'a-mmeta';
        meta.textContent = 'Inviata il ' + r.date + (r.to ? ' a ' + r.to : '');
        var f = document.createElement('iframe'); f.className = 'a-mbody';
        f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
        f.title = 'Risposta inviata il ' + r.date;
        f.srcdoc = r.html || ('<!doctype html><meta charset="utf-8"><body style="margin:16px;font:15px/1.55 Helvetica,Arial,sans-serif;color:#E6FFFA;background:#081C28;white-space:pre-wrap">' + esc(r.text || '') + '</body>');
        box.appendChild(meta); box.appendChild(f);
      });
    }).catch(function (x) { repliesFor = null; box.innerHTML = ''; var p = document.createElement('p'); p.className = 'k-err'; p.textContent = x.message; box.appendChild(p); });
  });

  $('mv-unread').addEventListener('click', function () {
    if (!cur) return;
    var uid = cur.uid;
    mapi({ action: 'unread', uid: uid }).then(function () {
      mails.forEach(function (m) { if (m.uid === uid) m.seen = false; });
      renderMail();
    }).catch(function (x) { msg($('m-err'), x.message); });
  });

  function replyData() {
    return { uid: cur && cur.uid, title: $('rp-title').value.trim(), body: $('rp-body').value,
      buttonText: $('rp-btext').value.trim(), buttonUrl: $('rp-burl').value.trim(), quote: $('rp-quote').checked };
  }
  function replyPreview() {
    var d = replyData();
    if (!d.body.trim()) { msg($('rp-err'), 'Scrivi il testo per vedere l\'anteprima.'); return; }
    mapi(Object.assign({ action: 'preview', quoteFrom: cur.fromName || cur.fromAddr, quoteDate: cur.date, quoteText: cur.text }, d))
      .then(function (r) { msg($('rp-err'), ''); $('rp-preview').srcdoc = r.html; show($('rp-preview'), true); $('rp-prev').textContent = 'Aggiorna anteprima'; })
      .catch(function (x) { msg($('rp-err'), x.message); });
  }
  $('rp-prev').addEventListener('click', replyPreview);
  ['rp-title', 'rp-body', 'rp-btext', 'rp-burl', 'rp-quote'].forEach(function (id) {
    $(id).addEventListener('input', function () { if (!$('rp-preview').hidden) schedule(); });
  });
  var rpt = null; function schedule() { clearTimeout(rpt); rpt = setTimeout(replyPreview, 700); }

  $('reply-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!cur) return;
    var d = replyData();
    if (!d.body.trim()) { msg($('rp-err'), 'Scrivi il testo della risposta.'); return; }
    var b = $('rp-send'); b.disabled = true; b.textContent = 'Invio…'; msg($('rp-err'), ''); msg($('rp-ok'), '');
    mapi(Object.assign({ action: 'reply' }, d)).then(function (r) {
      msg($('rp-ok'), 'Risposta inviata a ' + r.to + ' («' + r.subject + '»).');
      ['rp-title', 'rp-body', 'rp-btext', 'rp-burl'].forEach(function (id) { $(id).value = ''; });
      show($('rp-preview'), false);
      mails.forEach(function (m) { if (m.uid === cur.uid) { m.answered = true; m.seen = true; } });
      renderMail(); setupReplies();
    }).catch(function (x) { msg($('rp-err'), x.message); })
      .then(function () { b.disabled = false; b.textContent = 'Invia risposta'; });
  });

  /* ---------- Avvio ---------- */
  token = load(KEY);
  notifyTo = load('k88_notify') || notifyTo;
  if (token) enter(); else $('l-user').focus();
})();
