/* Conferma o annullamento dell'iscrizione alla newsletter */
(function () {
  'use strict';
  var CFG = window.AKIRE88 || {};
  var params = new URLSearchParams(location.search);
  var azione = params.get('azione');
  var token = params.get('token') || '';
  var title = document.getElementById('nl-title');
  var text = document.getElementById('nl-text');

  function done(t, p) { title.textContent = t; text.textContent = p; }

  var action = azione === 'conferma' ? 'confirm' : azione === 'disiscrivi' ? 'unsubscribe' : null;
  if (!action || !/^[a-f0-9-]{36}$/i.test(token)) {
    done('Link non valido', 'Il link sembra incompleto. Prova ad aprirlo di nuovo dall\'email oppure scrivici ad assistenza@akire88.it.');
    return;
  }
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
    done('Servizio non disponibile', 'Riprova tra poco oppure scrivici ad assistenza@akire88.it.');
    return;
  }

  fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/newsletter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': CFG.supabaseAnonKey,
      'Authorization': 'Bearer ' + CFG.supabaseAnonKey
    },
    body: JSON.stringify({ action: action, token: token })
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      if (action === 'confirm') {
        done('Iscrizione confermata!', 'Benvenuta e benvenuto nella newsletter di Akire88. Ti scriveremo solo quando avremo qualcosa da dire.');
      } else {
        done('Disiscrizione completata', 'Non riceverai più la newsletter di Akire88. Se cambi idea puoi iscriverti di nuovo dal sito.');
      }
    });
  }).catch(function () {
    done('Link scaduto o già usato', 'Se serve, iscriviti di nuovo dal sito oppure scrivici ad assistenza@akire88.it.');
  });
})();
