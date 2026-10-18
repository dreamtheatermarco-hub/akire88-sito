/* Akire88 – interazioni del sito (nessuna libreria, nessun cookie) */
(function () {
  'use strict';

  var CFG = window.AKIRE88 || {};
  var EMAIL = 'assistenza@akire88.it';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function show(key, on) { $all('[data-if="' + key + '"]').forEach(function (el) { el.hidden = !on; }); }

  /* Chiamata alle funzioni Supabase (Edge Functions) */
  function callFunction(name, payload) {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
      return Promise.reject(new Error('not-configured'));
    }
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CFG.supabaseAnonKey,
        'Authorization': 'Bearer ' + CFG.supabaseAnonKey
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error(data.error || 'request-failed'); err.code = data.error; throw err;
        }
        return data;
      });
    });
  }

  function showError(box, msg) {
    if (!box) return;
    box.innerHTML = msg;
    box.hidden = false;
  }
  var GENERIC_ERR = 'Non siamo riusciti a inviare. Riprova tra poco oppure scrivici a <a href="mailto:' + EMAIL + '">' + EMAIL + '</a>.';

  /* ---------------- Modulo di contatto ---------------- */
  var overlayWrap = $('[data-if="modal"]');
  var overlay = $('#k-overlay');
  var dialog = overlay ? $('[role="dialog"]', overlay) : null;
  var form = $('#k-contact-form');
  var lastFocus = null;
  var currentType = 'Informazioni generali';

  function setType(t) {
    currentType = t;
    $all('.k-chip[data-type]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-type') === t ? 'true' : 'false'); });
    $all('.js-seltype').forEach(function (s) { s.textContent = t; });
  }

  function openModal(type) {
    lastFocus = document.activeElement;
    setType(type || 'Informazioni generali');
    show('notSent', true); show('sent', false);
    var err = form && $('.k-err', form); if (err) err.hidden = true;
    show('modal', true);
    document.body.classList.add('k-lock');
    var first = $('.k-chip[aria-pressed="true"]', dialog) || $('button', dialog);
    if (first) first.focus();
  }

  function closeModal() {
    show('modal', false);
    document.body.classList.remove('k-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open]');
    if (opener) { e.preventDefault(); openModal(opener.getAttribute('data-open')); return; }
    if (e.target.closest('[data-close]')) { e.preventDefault(); closeModal(); return; }
    var chip = e.target.closest('.k-chip[data-type]');
    if (chip) { setType(chip.getAttribute('data-type')); return; }
    if (overlay && e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (!overlayWrap || overlayWrap.hidden) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'Tab' && dialog) {
      var f = $all('a[href],button:not([disabled]),input:not([type="hidden"]):not([tabindex="-1"]),textarea,select', dialog)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type="submit"]', form);
      var err = $('.k-err', form);
      err.hidden = true;
      var fd = new FormData(form);
      var payload = {
        tipo: currentType,
        nome: (fd.get('nome') || '').trim(),
        email: (fd.get('email') || '').trim(),
        azienda: (fd.get('azienda') || '').trim(),
        telefono: (fd.get('telefono') || '').trim(),
        messaggio: (fd.get('messaggio') || '').trim(),
        privacy: !!fd.get('privacy'),
        website: fd.get('website') || ''
      };
      btn.disabled = true;
      callFunction('contact', payload).then(function () {
        form.reset();
        show('notSent', false); show('sent', true);
        var closeBtn = $('[data-if="sent"] [data-close]', dialog); if (closeBtn) closeBtn.focus();
      }).catch(function () {
        showError(err, GENERIC_ERR);
      }).then(function () { btn.disabled = false; });
    });
  }

  /* ---------------- Newsletter (doppia conferma) ---------------- */
  var nl = $('#k-nl-form');
  if (nl) {
    nl.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type="submit"]', nl);
      var err = $('[data-if="nlNotSent"] .k-err');
      if (err) err.hidden = true;
      var fd = new FormData(nl);
      btn.disabled = true;
      callFunction('newsletter', {
        action: 'subscribe',
        email: (fd.get('email') || '').trim(),
        website: fd.get('website') || ''
      }).then(function () {
        show('nlNotSent', false); show('nlSent', true);
      }).catch(function () {
        showError(err, GENERIC_ERR);
      }).then(function () { btn.disabled = false; });
    });
  }

  /* ---------------- IA nelle app: selettore livello ---------------- */
  $all('.k-mode').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-mode');
      $all('.k-mode').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      ['0', '1', '2'].forEach(function (k) { show('m' + k, k === m); });
    });
  });
})();
