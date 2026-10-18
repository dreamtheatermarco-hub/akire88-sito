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

  function api(payload) {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return Promise.reject(new Error('Configurazione Supabase mancante.'));
    if (token) payload.token = token;
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + CFG.supabaseAnonKey },
      body: JSON.stringify(payload)
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
      ['iscritti', 'scrivi', 'inviate'].forEach(function (k) { show($('tab-' + k), k === t.dataset.tab); });
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

  /* ---------- Avvio ---------- */
  token = load(KEY);
  notifyTo = load('k88_notify') || notifyTo;
  if (token) enter(); else $('l-user').focus();
})();
