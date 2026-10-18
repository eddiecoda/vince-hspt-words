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

  var api = { key: key, DAY: DAY, INTERVALS: INTERVALS, MASTERY_STREAK: MASTERY_STREAK, STORE_KEY: STORE_KEY,
    record: record, getStat: getStat, isMastered: isMastered, todaysWords: todaysWords, reviewWords: reviewWords,
    stats: stats, shuffle: shuffle, Session: Session, load: load, save: save, reset: reset, accuracy: accuracy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SRS = api;
})(this);
