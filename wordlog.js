/* Daily words log: sends one cumulative record per kid per ET day to FormSubmit (emails codafamily@mail.grokbot.com).
   No secrets here: the endpoint is FormSubmit's public alias for that inbox.
   source=auto  -> sent when Today's set is opened, when it's finished / all cards answered, and when the page is hidden (only if something changed).
   source=button -> the "I did my words today" button. Works in the browser (window.WordLog) and in Node (module.exports). */
(function (root) {
  var ENDPOINT = 'https://formsubmit.co/ajax/a032bbfd0d3415b6a461ca7de57bdeda';

  function etDate(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  }
  function etTime(d) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d || new Date()) + ' ET';
  }

  // Pure: build the record from the day's state and the current newest set.
  function summary(state, setKeys) {
    var answered = 0, right = 0;
    setKeys.forEach(function (k) { if (k in state.firstTry) { answered++; if (state.firstTry[k]) right++; } });
    return { set_size: setKeys.length, opened_set: state.opened ? 'yes' : 'no', answered: answered, right: right,
      completed_all: setKeys.length > 0 && answered >= setKeys.length ? 'yes' : 'no' };
  }

  function create(opts) {
    // opts: { kid, storage, keyFn, setFn: () => newest-set words, fetch, now }
    var storage = opts.storage, KEY = opts.kid.toLowerCase() + '-words-log-v1';
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
    var now = opts.now || function () { return new Date(); };
    var inflight = '';

    function load() {
      var s; try { s = JSON.parse(storage.getItem(KEY)); } catch (e) { s = null; }
      var today = etDate(now());
      if (!s || s.date !== today) s = { date: today, opened: false, firstTry: {}, sentSig: '', buttonDone: false };
      return s;
    }
    function save(s) { try { storage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

    function setInfo() {
      var set = opts.setFn() || [];
      return { id: set.length ? set[0].addedDate : '', keys: set.map(opts.keyFn) };
    }

    function send(source, force) {
      var s = load(), info = setInfo(), sum = summary(s, info.keys);
      var sig = JSON.stringify([info.id, sum]);
      if (source === 'auto' && !force && (sig === s.sentSig || sig === inflight)) return Promise.resolve('unchanged');
      if (source === 'auto' && !s.opened && sum.answered === 0) return Promise.resolve('nothing yet');
      var rec = { _subject: 'WORDS LOG ' + opts.kid + ' ' + s.date + ' ' + source, _template: 'table', _captcha: 'false',
        kid: opts.kid, date_et: s.date, time_et: etTime(now()), source: source, set: info.id,
        set_size: sum.set_size, opened_set: sum.opened_set, answered: sum.answered, right: sum.right, completed_all: sum.completed_all,
        button_tapped_today: (source === 'button' || s.buttonDone) ? 'yes' : 'no' };
      if (!doFetch) return Promise.reject(new Error('no fetch'));
      if (source === 'auto') inflight = sig;
      return doFetch(ENDPOINT, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(rec) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (String(j.success) !== 'true') throw new Error(j.message || 'send failed');
          var s2 = load();
          if (source === 'auto') s2.sentSig = sig; else s2.buttonDone = true;
          save(s2);
          return rec;
        })
        .finally(function () { if (inflight === sig) inflight = ''; });
    }

    return {
      etDate: function () { return etDate(now()); },
      state: load,
      openedSet: function () { var s = load(); var first = !s.opened; s.opened = true; save(s); if (first) send('auto').catch(function () {}); },
      // Call on each first attempt at a card in a session (the same moment the app records stats).
      answered: function (key, ok) {
        var info = setInfo(); if (info.keys.indexOf(key) < 0) return;
        var s = load(); if (key in s.firstTry) return;
        s.firstTry[key] = !!ok; save(s);
        if (summary(s, info.keys).completed_all === 'yes') send('auto').catch(function () {});
      },
      flush: function () { return send('auto').catch(function () {}); },
      button: function () { return send('button'); },
      buttonDone: function () { return load().buttonDone; }
    };
  }

  var api = { create: create, summary: summary, etDate: etDate, ENDPOINT: ENDPOINT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WordLog = api;
})(this);
