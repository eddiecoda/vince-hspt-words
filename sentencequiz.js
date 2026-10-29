/* Weekly "use it in a sentence" quiz.
   Works in the browser (window.SentenceQuiz) and in Node (module.exports).

   WORD DATA
   Each card in words.json should include:
     "sentence": one 8th-grade sentence with the word replaced by _____
   The blank token is exactly five underscores. Write the sentence so the
   word's part of speech (the base form stored in "word") fits the blank,
   and do not include the word itself. Context should point at that meaning.
   Example:
     "sentence": "The frozen puddle was so _____ that his shoe cracked the ice."
   If sentence is missing, has no single _____ blank, or still contains the
   word, the quiz uses the definition as the clue instead.

   WHEN IT OPENS
   QUIZ_WEEKDAY (0 = Sunday … 6 = Saturday, Eastern Time) is the only switch
   for the day. The quiz unlocks that morning and stays until it is finished.
   An unfinished quiz from the previous week stays open until it is done.
   The word list is practice from the 7 days before that unlock morning.

   WHAT COUNTS AS TOUGH (worst first)
   Flashcard attempts are stored under ATTEMPT_KEY, separate from SRS progress
   (vince-hspt-progress-v1), so old progress is left as it is:
     - missed at least once
     - several tries: 2+ wrong, or SEVERAL_TRIES attempts with at least one miss
     - slow: any answer at or above SLOW_MS
   If fewer than QUIZ_MIN cards qualify, other words practiced that week fill in.
   At most QUIZ_MAX. Cards with no timed attempts that week still count when
   saved progress was updated then (a wrong last result counts as a miss).
*/
(function (root) {
  var QUIZ_WEEKDAY = 0; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  var QUIZ_MIN = 10;
  var QUIZ_MAX = 15;
  var SLOW_MS = 20000;
  var SEVERAL_TRIES = 3;
  var BLANK = '_____';
  var TZ = 'America/New_York';
  var ATTEMPT_KEY = 'vince-hspt-attempts-v1';
  var QUIZ_KEY = 'vince-hspt-sentence-quiz-v1';
  var KEEP_MS = 60 * 24 * 60 * 60 * 1000;
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function key(w) { return w.word + ':' + (w.type || 'synonym'); }

  function etParts(date) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    var out = {};
    fmt.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') out[p.type] = p.value; });
    if (out.hour === '24') out.hour = '00';
    return out;
  }

  function ymd(y, m, d) {
    return String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function addDays(ymdStr, delta) {
    var p = ymdStr.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + delta));
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  // Midnight at the start of this calendar date in Eastern Time, as a UTC ms timestamp.
  function etMidnight(ymdStr) {
    var p = ymdStr.split('-'), y = +p[0], m = +p[1], d = +p[2];
    for (var h = 3; h <= 8; h++) {
      var t = Date.UTC(y, m - 1, d, h, 0, 0);
      var c = etParts(new Date(t));
      if (+c.year === y && +c.month === m && +c.day === d && c.hour === '00' && c.minute === '00') return t;
    }
    return Date.UTC(y, m - 1, d, 5, 0, 0);
  }

  function unlockId(now) {
    var p = etParts(new Date(now));
    var today = p.year + '-' + p.month + '-' + p.day;
    var wd = WD[p.weekday];
    if (wd == null) wd = 0;
    var back = (wd - QUIZ_WEEKDAY + 7) % 7;
    return addDays(today, -back);
  }

  function weekWindow(quizId) {
    return { id: quizId, start: etMidnight(addDays(quizId, -7)), end: etMidnight(quizId) };
  }

  function loadAttempts(storage) {
    try {
      var s = JSON.parse(storage.getItem(ATTEMPT_KEY));
      return (s && Array.isArray(s.attempts)) ? s.attempts : [];
    } catch (e) { return []; }
  }

  function recordAttempt(storage, attempt, now) {
    now = now || Date.now();
    var list = loadAttempts(storage);
    list.push({
      t: attempt.t || now,
      key: attempt.key,
      ok: !!attempt.ok,
      ms: Math.max(0, attempt.ms | 0)
    });
    var cutoff = now - KEEP_MS;
    list = list.filter(function (a) { return a && a.t >= cutoff && a.key; });
    if (list.length > 2000) list = list.slice(list.length - 2000);
    try { storage.setItem(ATTEMPT_KEY, JSON.stringify({ attempts: list })); } catch (e) {}
    return list;
  }

  function loadState(storage) {
    try {
      var s = JSON.parse(storage.getItem(QUIZ_KEY));
      if (!s || typeof s !== 'object') return { byWeek: {} };
      if (!s.byWeek || typeof s.byWeek !== 'object') s.byWeek = {};
      return s;
    } catch (e) { return { byWeek: {} }; }
  }

  function saveState(storage, state) {
    try { storage.setItem(QUIZ_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function markComplete(storage, id, result) {
    var s = loadState(storage);
    if (s.byWeek[id]) return { fresh: false, row: s.byWeek[id] };
    s.byWeek[id] = {
      correct: result.correct,
      total: result.total,
      missed: (result.missed || []).slice(),
      missedKeys: (result.missedKeys || []).slice(),
      at: result.at || Date.now(),
      emailed: false
    };
    saveState(storage, s);
    return { fresh: true, row: s.byWeek[id] };
  }

  function setEmailed(storage, id, emailed) {
    var s = loadState(storage);
    if (!s.byWeek[id]) return;
    s.byWeek[id].emailed = !!emailed;
    saveState(storage, s);
  }

  function normalizeAnswer(s) {
    return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function answersMatch(input, word) {
    return normalizeAnswer(input) === normalizeAnswer(word);
  }

  function usableSentence(card) {
    var s = card && typeof card.sentence === 'string' ? card.sentence.trim() : '';
    if (!s || s.split(BLANK).length !== 2) return '';
    if (s.toLowerCase().indexOf(String(card.word || '').toLowerCase()) >= 0) return '';
    return s;
  }

  function cmpWorst(a, b) {
    return b.score - a.score || b.wrongs - a.wrongs || b.slows - a.slows || b.tries - a.tries ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }

  function gatherAttempts(words, attempts, progress, quizId) {
    var win = weekWindow(quizId);
    var byKey = {};
    (words || []).forEach(function (w) { if (w && w.word) byKey[key(w)] = w; });
    var logged = (attempts || []).filter(function (a) {
      return a && byKey[a.key] && a.t >= win.start && a.t < win.end;
    });
    var seen = {};
    logged.forEach(function (a) { seen[a.key] = true; });
    var extra = [];
    if (progress) {
      Object.keys(byKey).forEach(function (k) {
        if (seen[k]) return;
        var s = progress[k];
        if (!s || !s.seen || !s.lastSeen) return;
        if (s.lastSeen < win.start || s.lastSeen >= win.end) return;
        if (s.lastResult !== 'right' && s.lastResult !== 'wrong') return;
        extra.push({ t: s.lastSeen, key: k, ok: s.lastResult === 'right', ms: 0 });
      });
    }
    return { win: win, byKey: byKey, attempts: logged.concat(extra) };
  }

  function buildQuiz(words, attempts, quizId, progress) {
    var g = gatherAttempts(words, attempts, progress, quizId);
    var groups = {};
    g.attempts.forEach(function (a) {
      var row = groups[a.key] || (groups[a.key] = { key: a.key, wrongs: 0, tries: 0, slows: 0, last: 0 });
      row.tries += 1;
      if (!a.ok) row.wrongs += 1;
      if ((a.ms || 0) >= SLOW_MS) row.slows += 1;
      if (a.t > row.last) row.last = a.t;
    });
    var rows = Object.keys(groups).map(function (k) {
      var row = groups[k];
      row.missed = row.wrongs >= 1;
      row.several = row.wrongs >= 2 || (row.tries >= SEVERAL_TRIES && row.wrongs >= 1);
      row.slow = row.slows >= 1;
      row.tough = row.missed || row.several || row.slow;
      row.score = row.wrongs * 5 + row.slows * 2 + Math.max(0, row.tries - 1);
      row.card = g.byKey[k];
      return row;
    }).sort(cmpWorst);
    var seenWord = {};
    rows = rows.filter(function (row) {
      var lw = row.card.word.toLowerCase();
      if (seenWord[lw]) return false;
      seenWord[lw] = true;
      return true;
    });
    var tough = rows.filter(function (r) { return r.tough; });
    var other = rows.filter(function (r) { return !r.tough; });
    var picked = tough.slice(0, QUIZ_MAX);
    if (picked.length < QUIZ_MIN) picked = picked.concat(other.slice(0, QUIZ_MIN - picked.length));
    return {
      id: quizId,
      start: g.win.start,
      end: g.win.end,
      toughCount: picked.filter(function (r) { return r.tough; }).length,
      fillerCount: picked.filter(function (r) { return !r.tough; }).length,
      items: picked.map(function (row) {
        var card = row.card;
        var sentence = usableSentence(card);
        return {
          key: row.key,
          word: card.word,
          type: card.type,
          definition: card.definition || '',
          example: card.example || '',
          sentence: sentence,
          fallback: !sentence,
          clue: sentence || (card.definition || ''),
          score: row.score,
          tough: row.tough
        };
      })
    };
  }

  function selectQuiz(words, attempts, state, now, progress) {
    now = now || Date.now();
    var completed = (state && state.byWeek) || {};
    var current = unlockId(now);
    var prev = addDays(current, -7);
    var prevBuilt = buildQuiz(words, attempts, prev, progress);
    if (!completed[prev] && prevBuilt.items.length) {
      return { phase: 'ready', id: prev, built: prevBuilt, overdue: true, dayName: DAY_NAMES[QUIZ_WEEKDAY] };
    }
    var built = buildQuiz(words, attempts, current, progress);
    if (completed[current]) {
      return { phase: 'done', id: current, built: built, result: completed[current], overdue: false, dayName: DAY_NAMES[QUIZ_WEEKDAY] };
    }
    if (!built.items.length) {
      if (completed[prev]) {
        return { phase: 'done', id: prev, built: prevBuilt, result: completed[prev], overdue: false, dayName: DAY_NAMES[QUIZ_WEEKDAY] };
      }
      return { phase: 'empty', id: current, built: built, overdue: false, dayName: DAY_NAMES[QUIZ_WEEKDAY] };
    }
    return { phase: 'ready', id: current, built: built, overdue: false, dayName: DAY_NAMES[QUIZ_WEEKDAY] };
  }

  // A fixed sample week so the quiz can be tried on localhost without waiting for Sunday.
  function demoWeekAttempts(words, now) {
    var byWord = {};
    (words || []).forEach(function (w) { byWord[w.word] = w; });
    var win = weekWindow(unlockId(now || Date.now()));
    var plan = [
      { word: 'TEDIOUS', events: [{ ok: false, ms: 4000 }, { ok: false, ms: 5000 }, { ok: false, ms: 6000 }] },
      { word: 'CONCISE', events: [{ ok: false, ms: 4000 }, { ok: false, ms: 4500 }, { ok: true, ms: 3000 }] },
      { word: 'HUMBLE', events: [{ ok: false, ms: 3000 }, { ok: false, ms: 3500 }] },
      { word: 'BRITTLE', events: [{ ok: false, ms: 25000 }] },
      { word: 'ELATED', events: [{ ok: false, ms: 4000 }] },
      { word: 'FEASIBLE', events: [{ ok: false, ms: 4000 }] },
      { word: 'HOSTILE', events: [{ ok: true, ms: SLOW_MS }] },
      { word: 'ADEQUATE', events: [{ ok: true, ms: 3000 }] },
      { word: 'DISMAL', events: [{ ok: true, ms: 3000 }] },
      { word: 'FRUGAL', events: [{ ok: true, ms: 3000 }] },
      { word: 'MEAGER', events: [{ ok: true, ms: 3000 }] },
      { word: 'NOVICE', events: [{ ok: true, ms: 3000 }] },
      { word: 'PLACID', events: [{ ok: true, ms: 3000 }] },
      { word: 'VIGILANT', events: [{ ok: true, ms: 3000 }] },
      { word: 'ZEALOUS', events: [{ ok: true, ms: 3000 }] }
    ];
    var attempts = [], t = win.start + 60 * 60 * 1000;
    plan.forEach(function (item) {
      var card = byWord[item.word];
      if (!card) return;
      item.events.forEach(function (ev) {
        if (t >= win.end) return;
        attempts.push({ t: t, key: key(card), ok: ev.ok, ms: ev.ms });
        t += 60 * 1000;
      });
      t += 3 * 60 * 60 * 1000;
    });
    return attempts;
  }

  var api = {
    QUIZ_WEEKDAY: QUIZ_WEEKDAY, QUIZ_MIN: QUIZ_MIN, QUIZ_MAX: QUIZ_MAX, SLOW_MS: SLOW_MS,
    SEVERAL_TRIES: SEVERAL_TRIES, BLANK: BLANK, TZ: TZ, ATTEMPT_KEY: ATTEMPT_KEY, QUIZ_KEY: QUIZ_KEY,
    DAY_NAME: DAY_NAMES[QUIZ_WEEKDAY], key: key, etParts: etParts, addDays: addDays, etMidnight: etMidnight,
    unlockId: unlockId, weekWindow: weekWindow, loadAttempts: loadAttempts, recordAttempt: recordAttempt,
    loadState: loadState, saveState: saveState, markComplete: markComplete, setEmailed: setEmailed,
    normalizeAnswer: normalizeAnswer, answersMatch: answersMatch, usableSentence: usableSentence,
    buildQuiz: buildQuiz, selectQuiz: selectQuiz, demoWeekAttempts: demoWeekAttempts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SentenceQuiz = api;
})(this);
