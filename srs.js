/* Spaced-repetition + session logic. Works in the browser (window.SRS) and in Node (module.exports). */
(function (root) {
  var DAY = 24 * 60 * 60 * 1000;
  // Leitner boxes: a miss sends a word to box 0 (due right away); each right answer moves it up one box.
  var INTERVALS = [0, 1 * DAY, 2 * DAY, 4 * DAY, 8 * DAY, 16 * DAY];
  var MASTERY_STREAK = 3; // right 3 times in a row = mastered
  var STORE_KEY = 'vince-hspt-progress-v1';

  // A card is a word + question type, so the same word can be both a synonym and an antonym card.
  function key(w) { return w.word + ':' + (w.type || 'synonym'); }
  function blank() { return { seen: 0, correct: 0, streak: 0, box: 0, lastSeen: null, due: 0, lastResult: null }; }

  function getStat(progress, word) { return progress[word] || blank(); }

  function record(progress, word, isCorrect, now) {
    now = now || Date.now();
    var s = Object.assign(blank(), progress[word]);
    s.seen += 1;
    s.lastSeen = now;
    if (isCorrect) {
      s.correct += 1;
      s.streak += 1;
      s.box = Math.min(s.box + 1, INTERVALS.length - 1);
      s.lastResult = 'right';
    } else {
      s.streak = 0;
      s.box = 0;
      s.lastResult = 'wrong';
    }
    s.due = now + INTERVALS[s.box];
    progress[word] = s;
    return s;
  }

  function isMastered(s) { return !!s && s.streak >= MASTERY_STREAK; }

  // Newest batch of words = "Today's 20" (today's addedDate if present, else the latest date in the file).
  function todaysWords(words, todayStr) {
    if (!words.length) return [];
    var dates = words.map(function (w) { return w.addedDate; }).sort();
    var target = dates.indexOf(todayStr) >= 0 ? todayStr : dates[dates.length - 1];
    return words.filter(function (w) { return w.addedDate === target; });
  }

  // Review: words already seen that were missed or are due again. Missed (box 0) first, then lowest accuracy.
  function reviewWords(words, progress, now) {
    now = now || Date.now();
    return words.filter(function (w) {
      var s = progress[key(w)];
      if (!s || !s.seen) return false;
      return s.lastResult === 'wrong' || s.due <= now;
    }).sort(function (a, b) {
      var sa = progress[key(a)], sb = progress[key(b)];
      if (sa.box !== sb.box) return sa.box - sb.box;
      return accuracy(sa) - accuracy(sb);
    });
  }

  function accuracy(s) { return s && s.seen ? s.correct / s.seen : 0; }

  function stats(words, progress) {
    var seen = 0, correct = 0, mastered = 0, missedNow = 0;
    words.forEach(function (w) {
      var s = progress[key(w)];
      if (!s) return;
      seen += s.seen; correct += s.correct;
      if (isMastered(s)) mastered++;
      if (s.lastResult === 'wrong') missedNow++;
    });
    var tough = words.filter(function (w) { var s = progress[key(w)]; return s && s.seen > s.correct; })
      .map(function (w) { var s = progress[key(w)]; return { key: key(w), word: w.word, type: w.type, seen: s.seen, correct: s.correct, acc: accuracy(s) }; })
      .sort(function (a, b) { return a.acc - b.acc || b.seen - a.seen; })
      .slice(0, 10);
    return { total: words.length, answered: seen, correct: correct, accuracy: seen ? correct / seen : 0,
      mastered: mastered, missedNow: missedNow,
      practiced: words.filter(function (w) { return progress[key(w)] && progress[key(w)].seen; }).length, tough: tough };
  }

  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // A session is a queue of words. A missed word is re-inserted a few cards later (once) so it comes back sooner.
  function Session(list, rnd) { this.queue = list.slice(); this.requeued = {}; this.done = 0; this.right = 0; this.firstTry = {}; this.rnd = rnd; }
  Session.prototype.current = function () { return this.queue[0] || null; };
  Session.prototype.answer = function (isCorrect) {
    var w = this.queue.shift();
    var k = key(w);
    if (!(k in this.firstTry)) { this.firstTry[k] = isCorrect; this.done++; if (isCorrect) this.right++; }
    if (!isCorrect && !this.requeued[k]) {
      this.requeued[k] = true;
      var pos = Math.min(3, this.queue.length);
      this.queue.splice(pos, 0, w);
    }
    return w;
  };
  Session.prototype.finished = function () { return this.queue.length === 0; };

  function load(storage) {
    try { return JSON.parse(storage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save(storage, progress) { storage.setItem(STORE_KEY, JSON.stringify(progress)); }
  function reset(storage) { storage.removeItem(STORE_KEY); }

  // ---- Word sets: the "current set" advances to the next set as soon as every card in it has been answered right once. ----
  // Each card has set (string id) and order (number). Older cards use their addedDate as the set id.
  // Bank sets have ids like L-001 / V-001; dated ids are the original daily batches.
  var SET_KEY = STORE_KEY.replace('progress', 'sets');
  function setId(w) { return w.set || w.addedDate; }
  function setList(words) {
    var by = {}, out = [];
    words.forEach(function (w) {
      var id = setId(w);
      if (!by[id]) { by[id] = { id: id, order: typeof w.order === 'number' ? w.order : 0, date: w.addedDate || '', cards: [] }; out.push(by[id]); }
      by[id].cards.push(w);
    });
    return out.sort(function (a, b) { return a.order - b.order || a.date.localeCompare(b.date) || a.id.localeCompare(b.id); });
  }
  function isDated(id) { return /^\d{4}-\d{2}-\d{2}$/.test(id); }
  function loadSets(storage) {
    var s; try { s = JSON.parse(storage.getItem(SET_KEY)); } catch (e) { s = null; }
    s = s || {};
    return { current: s.current || '', completed: s.completed || [], right: s.right || {}, opened: s.opened || {},
      day: s.day || null, notice: s.notice || '' };
  }
  function saveSets(storage, st) { try { storage.setItem(SET_KEY, JSON.stringify(st)); } catch (e) {} }
  // A card counts once it has been answered right at least once (now, or in an earlier session).
  function cardDone(st, progress, keyFn, w) { var k = keyFn(w), p = progress[k]; return !!st.right[k] || !!(p && p.correct > 0); }
  function setProgress(set, st, progress, keyFn) {
    var right = 0, answered = 0;
    set.cards.forEach(function (w) {
      var k = keyFn(w), p = progress[k];
      if (cardDone(st, progress, keyFn, w)) right++;
      if ((p && p.seen > 0) || k in st.right) answered++;
    });
    return { total: set.cards.length, answered: answered, right: right, done: set.cards.length > 0 && right >= set.cards.length };
  }
  function isSetDone(set, st, progress, keyFn) { return st.completed.indexOf(set.id) >= 0 || setProgress(set, st, progress, keyFn).done; }
  function nextSet(sets, cur, st, progress, keyFn) {
    var i = sets.findIndex(function (s) { return s.id === cur; });
    for (var j = i + 1; j < sets.length; j++) if (!isSetDone(sets[j], st, progress, keyFn)) return sets[j];
    return null;
  }
  // Work out the current set: the stored one, else the newest dated (original daily) batch, else the first set.
  // A finished current set moves on to the next unfinished set (e.g. after a top-up of new sets).
  function storedCurrent(sets, st) {
    var cur = sets.find(function (s) { return s.id === st.current; });
    if (!cur && sets.length) {
      var dated = sets.filter(function (s) { return isDated(s.id); });
      cur = dated.length ? dated[dated.length - 1] : sets[0];
      st.current = cur.id;
    }
    return cur || null;
  }
  function resolveCurrent(words, st, progress, keyFn) {
    var sets = setList(words);
    if (!sets.length) return { set: null, sets: sets, exhausted: true };
    var cur = storedCurrent(sets, st);
    // Only a set already reported as completed moves on here; an unreported finish is reported by completeIfDone / markSetAnswer.
    if (st.completed.indexOf(cur.id) >= 0) {
      var nx = nextSet(sets, cur.id, st, progress, keyFn);
      if (nx) { cur = nx; st.current = nx.id; }
    }
    var exhausted = st.completed.indexOf(cur.id) >= 0 && !nextSet(sets, cur.id, st, progress, keyFn);
    return { set: cur, sets: sets, exhausted: exhausted };
  }
  // Record an answer against the current set. Returns {completed, from, to, exhausted} when this answer finished the set.
  function markSetAnswer(words, st, progress, keyFn, w, isCorrect) {
    // Uses the stored current set without auto-advancing, so the answer that finishes a set is the one that reports it.
    var sets = setList(words), cur = storedCurrent(sets, st), r = { sets: sets };
    if (!cur || setId(w) !== cur.id) return null;
    var k = keyFn(w);
    if (isCorrect) st.right[k] = true; else if (!(k in st.right)) st.right[k] = false;
    return completeIfDone(words, st, progress, keyFn);
  }
  // If the stored current set is finished but not yet reported, mark it completed and advance. Returns the result once.
  function completeIfDone(words, st, progress, keyFn) {
    var sets = setList(words), cur = storedCurrent(sets, st), r = { sets: sets };
    if (!cur || st.completed.indexOf(cur.id) >= 0) return null;
    var p = setProgress(cur, st, progress, keyFn);
    if (!p.done) return null;
    st.completed.push(cur.id);
    var nx = nextSet(r.sets, cur.id, st, progress, keyFn);
    if (nx) st.current = nx.id;
    var out = { completed: true, from: cur.id, to: nx ? nx.id : null, exhausted: !nx, answered: p.answered, right: p.right };
    st.notice = nx ? 'unlocked' : 'soon';
    return out;
  }
  // Cards the kid can see in Mix / Review / Stats: sets up to and including the current one (later bank sets stay locked).
  function unlockedWords(words, st, progress, keyFn) {
    var r = resolveCurrent(words, st, progress, keyFn);
    if (!r.set) return words;
    var o = r.set.order, cid = r.set.id;
    var open = {}; r.sets.forEach(function (s) { if (s.order <= o || s.id === cid || st.completed.indexOf(s.id) >= 0) open[s.id] = 1; });
    return words.filter(function (w) { return open[setId(w)]; });
  }
  // The set the daily words log reports for today: the first set worked today (so a set finished today stays "completed_all").
  function daySet(words, st, progress, keyFn, today) {
    var r = resolveCurrent(words, st, progress, keyFn);
    if (!st.day || st.day.date !== today) st.day = { date: today, id: r.set ? r.set.id : '' };
    return (r.sets.find(function (s) { return s.id === st.day.id; }) || r.set || { cards: [] }).cards;
  }

  // Coda Stars hook: fire-and-forget POST. Every error is swallowed; never blocks the UI.
  var STARS_URL = 'https://coda-kids-app.vercel.app/api/vocab/event';
  function postStarsEvent(fetchFn, payload) {
    try {
      if (!fetchFn) return Promise.resolve(false);
      // text/plain keeps it a "simple" cross-origin request (no CORS preflight); the body is JSON.
      return Promise.resolve(fetchFn(STARS_URL, { method: 'POST', mode: 'cors', keepalive: true, credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload) }))
        .then(function (r) { return !!(r && r.ok); }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  var api = { key: key, DAY: DAY, INTERVALS: INTERVALS, MASTERY_STREAK: MASTERY_STREAK, STORE_KEY: STORE_KEY,
    record: record, getStat: getStat, isMastered: isMastered, todaysWords: todaysWords, reviewWords: reviewWords,
    stats: stats, shuffle: shuffle, Session: Session, load: load, save: save, reset: reset, accuracy: accuracy,
    SET_KEY: SET_KEY, setId: setId, setList: setList, loadSets: loadSets, saveSets: saveSets, setProgress: setProgress, isSetDone: isSetDone,
    nextSet: nextSet, resolveCurrent: resolveCurrent, markSetAnswer: markSetAnswer, completeIfDone: completeIfDone, unlockedWords: unlockedWords, daySet: daySet,
    STARS_URL: STARS_URL, postStarsEvent: postStarsEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SRS = api;
})(this);
