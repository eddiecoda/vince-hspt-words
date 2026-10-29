(function () {
  var $ = function (id) { return document.getElementById(id); };
  var K = SRS.key;
  var words = [], progress = SRS.load(localStorage), session = null, answered = false;
  var shownAt = 0, hiddenMs = 0, hiddenAt = 0;
  var sq = null, sqLocked = false, sqSending = false, sqDone = null;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var wlog = WordLog.create({ kid: 'Vince', storage: localStorage, keyFn: function (w) { return K(w); },
    setFn: function () { return SRS.todaysWords(words, todayStr()); } });
  var MODES = { today: "📅 Today's set", review: '🔁 Review missed', all: '🎲 Mix', synonym: '🟰 Synonyms', antonym: '↔️ Antonyms' };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function show(id) {
    ['home', 'quiz', 'done', 'stats', 'sentence', 'sentenceDone'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    window.scrollTo(0, 0);
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'today';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function typeTag(w) { return '<span class="tag ' + w.type + '">' + (w.type === 'antonym' ? 'ANT' : 'SYN') + '</span>'; }
  function label(w) { return typeTag(w) + ' ' + esc(w.word); }
  function byKey(k) { return words.find(function (x) { return K(x) === k; }); }
  function ofType(t) { return words.filter(function (w) { return w.type === t; }); }

  // Pick up to 20 cards from a pool: not-yet-mastered first, plus a few mastered ones.
  function pick(pool) {
    var notM = pool.filter(function (w) { return !SRS.isMastered(progress[K(w)]); });
    var m = pool.filter(function (w) { return SRS.isMastered(progress[K(w)]); });
    return SRS.shuffle(SRS.shuffle(notM).concat(SRS.shuffle(m).slice(0, 3)).slice(0, 20));
  }

  function refreshHome() {
    var t = SRS.todaysWords(words, todayStr()), r = SRS.reviewWords(words, progress), st = SRS.stats(words, progress);
    $('todayCount').textContent = t.length;
    $('reviewCount').textContent = r.length;
    $('allCount').textContent = words.length;
    $('synCount').textContent = ofType('synonym').length;
    $('antCount').textContent = ofType('antonym').length;
    $('btnReview').disabled = r.length === 0;
    updateSentenceHome();
    var newest = t.length ? t[0].addedDate : '';
    $('homeSummary').innerHTML = words.length
      ? 'You have <b>' + words.length + '</b> cards. <b>' + st.mastered + '</b> mastered so far' +
        (st.answered ? ', <b>' + Math.round(st.accuracy * 100) + '%</b> accuracy.' : ". Start with Today's set!") +
        (newest ? '<br><span class="small">Newest cards added ' + esc(newest) + '</span>' : '')
      : 'No words found.';
  }

  function start(mode) {
    var list;
    if (mode === 'today') list = SRS.shuffle(SRS.todaysWords(words, todayStr()));
    else if (mode === 'review') list = SRS.reviewWords(words, progress).slice(0, 20);
    else if (mode === 'synonym' || mode === 'antonym') list = pick(ofType(mode));
    else list = pick(words);
    if (!list.length) return;
    if (mode === 'today') wlog.openedSet();
    session = new SRS.Session(list);
    $('modeLabel').textContent = MODES[mode];
    show('quiz');
    renderCard();
  }

  function renderCard() {
    var w = session.current();
    if (!w) return finish();
    answered = false;
    var seenKeys = {}; session.queue.forEach(function (q) { if (!(K(q) in session.firstTry)) seenKeys[K(q)] = 1; });
    var total = Object.keys(session.firstTry).length + Object.keys(seenKeys).length;
    $('progressText').textContent = 'Card ' + Math.min(session.done + 1, total) + ' of ' + total + (K(w) in session.firstTry ? ' · try again!' : '');
    $('progressBar').style.width = (session.done / total * 100) + '%';
    var ant = w.type === 'antonym';
    $('typeTag').textContent = ant ? '↔️ ANTONYM' : '🟰 SYNONYM';
    $('typeTag').className = 'qtype ' + w.type;
    $('prompt').innerHTML = ant ? 'Which word means the <b>opposite</b> of…' : 'Which word means the <b>same</b> as…';
    $('stem').textContent = w.word.toUpperCase();
    $('feedback').classList.add('hidden');
    shownAt = Date.now();
    hiddenMs = 0;
    if (document.visibilityState === 'hidden') hiddenAt = shownAt; else hiddenAt = 0;
    var box = $('choices'); box.innerHTML = '';
    SRS.shuffle(w.choices).forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span>' + esc(c) + '</span>';
      b.onclick = function () { choose(b, c, w); };
      b.dataset.value = c;
      box.appendChild(b);
    });
  }

  function choose(btn, choice, w) {
    if (answered) return;
    answered = true;
    var ok = choice === w.answer, k = K(w);
    var first = !(k in session.firstTry);
    // Only the first attempt in a session counts toward stats.
    if (first) { SRS.record(progress, k, ok); SRS.save(localStorage, progress); wlog.answered(k, ok); }
    var extra = hiddenAt ? (Date.now() - hiddenAt) : 0;
    SentenceQuiz.recordAttempt(localStorage, { key: k, ok: ok, ms: Math.max(0, Date.now() - shownAt - hiddenMs - extra) });
    session.answer(ok);
    Array.prototype.forEach.call($('choices').children, function (b) {
      b.disabled = true;
      if (b.dataset.value === w.answer) b.classList.add('correct');
    });
    var card = $('quiz').querySelector('.qcard');
    if (!ok) { btn.classList.add('wrong'); card.classList.add('shake'); } else btn.classList.add('pop');
    setTimeout(function () { card.classList.remove('shake'); }, 400);
    var cheers = ['Correct! ✅', 'Nailed it! 💪', 'Nice! 🔥', 'Yes! 🙌', 'Locked in! 🎯'];
    var rel = w.type === 'antonym' ? 'the opposite is' : 'it means';
    $('verdict').textContent = ok ? cheers[Math.floor(Math.random() * cheers.length)] : 'Not quite — ' + rel + ' "' + w.answer + '"';
    $('verdict').className = 'verdict ' + (ok ? 'ok' : 'bad');
    $('definition').textContent = w.word.toLowerCase() + ': ' + w.definition;
    $('example').textContent = w.example;
    var s = SRS.getStat(progress, k);
    $('wordStat').textContent = 'Right ' + s.correct + ' of ' + s.seen + ' times' +
      (SRS.isMastered(s) ? ' · ✅ mastered!' : s.streak ? ' · streak ' + s.streak + '/' + SRS.MASTERY_STREAK : '') +
      (!ok && first ? ' · this one will come back soon' : '');
    $('feedback').classList.remove('hidden');
    $('btnNext').focus({ preventScroll: true });
    $('feedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finish() {
    var n = session.done, r = session.right, pct = n ? r / n : 0;
    $('doneScore').textContent = r + ' / ' + n;
    $('doneEmoji').textContent = pct >= 0.9 ? '🏆' : pct >= 0.7 ? '🎉' : pct >= 0.5 ? '👍' : '💪';
    $('doneTitle').textContent = pct >= 0.9 ? 'Outstanding!' : pct >= 0.7 ? 'Nice work!' : pct >= 0.5 ? 'Solid effort!' : 'Keep grinding!';
    var missed = Object.keys(session.firstTry).filter(function (k) { return !session.firstTry[k]; });
    $('doneMsg').textContent = missed.length ? 'Missed cards show up in "Review missed words" until you get them.' : 'Every card right on the first try!';
    $('doneMissed').innerHTML = missed.length ? '<ul class="missedlist">' + missed.map(function (k) {
      var w = byKey(k);
      return '<li>' + label(w) + ' → ' + esc(w.answer) + '</li>'; }).join('') + '</ul>' : '';
    $('btnDoneReview').classList.toggle('hidden', SRS.reviewWords(words, progress).length === 0);
    show('done');
    wlog.flush();
  }

  function renderStats() {
    var st = SRS.stats(words, progress);
    $('stAcc').textContent = st.answered ? Math.round(st.accuracy * 100) + '%' : '–';
    $('stMastered').textContent = st.mastered + '/' + st.total;
    $('stPracticed').textContent = st.practiced;
    $('stAnswered').textContent = st.answered;
    ['synonym', 'antonym'].forEach(function (t) {
      var c = 0, n = 0; ofType(t).forEach(function (w) { var s = progress[K(w)]; if (s) { c += s.correct; n += s.seen; } });
      $(t === 'synonym' ? 'stSyn' : 'stAnt').textContent = n ? Math.round(c / n * 100) + '%' : '–';
    });
    $('toughList').innerHTML = st.tough.map(function (t) {
      var w = byKey(t.key);
      return '<li>' + label(w) + ' (' + esc(w.answer) + ') — right ' + t.correct + ' of ' + t.seen + '</li>'; }).join('');
    $('toughEmpty').classList.toggle('hidden', st.tough.length > 0);
    $('wordTable').innerHTML = words.slice().sort(function (a, b) { return b.addedDate.localeCompare(a.addedDate) || a.word.localeCompare(b.word); })
      .map(function (w) {
        var s = progress[K(w)];
        return '<tr><td>' + label(w) + (SRS.isMastered(s) ? ' ✅' : '') + '</td><td>' + (s ? s.correct + '/' + s.seen : '—') +
          '</td><td>' + fmtDate(s && s.lastSeen) + '</td></tr>'; }).join('');
    show('stats');
  }

  function renderDidWords(msg, err) {
    var done = wlog.buttonDone();
    $('btnDidWords').disabled = done;
    $('btnDidWords').textContent = done ? '✅ Words done for today!' : '✅ I did my words today';
    var m = msg || (done ? 'Thanks! Logged for ' + wlog.etDate() + '.' : '');
    $('didWordsMsg').textContent = m;
    $('didWordsMsg').classList.toggle('hidden', !m);
    $('didWordsMsg').classList.toggle('err', !!err);
  }
  function home() { refreshHome(); renderDidWords(); show('home'); }
  $('btnDidWords').onclick = function () {
    $('btnDidWords').disabled = true;
    $('didWordsMsg').classList.add('hidden');
    wlog.button().then(function () { renderDidWords('🎉 Thanks! Logged for ' + wlog.etDate() + '.'); })
      .catch(function () { renderDidWords("Couldn't send. Check the internet and tap again.", true); });
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = hiddenAt || Date.now(); wlog.flush(); }
    else if (hiddenAt) { hiddenMs += Date.now() - hiddenAt; hiddenAt = 0; }
  });
  window.addEventListener('pagehide', function () { wlog.flush(); });

  $('btnToday').onclick = function () { start('today'); };
  $('btnReview').onclick = function () { start('review'); };
  $('btnSyn').onclick = function () { start('synonym'); };
  $('btnAnt').onclick = function () { start('antonym'); };
  $('btnAll').onclick = function () { start('all'); };
  $('btnStats').onclick = renderStats;
  $('quitQuiz').onclick = home; $('quitStats').onclick = home; $('btnDoneHome').onclick = home;
  $('btnDoneReview').onclick = function () { start('review'); };
  $('btnNext').onclick = renderCard;
  $('btnReset').onclick = function () {
    if (confirm("Erase all of Vince's progress on this device, including the weekly quiz? This can't be undone.")) {
      SRS.reset(localStorage);
      localStorage.removeItem(SentenceQuiz.ATTEMPT_KEY);
      localStorage.removeItem(SentenceQuiz.QUIZ_KEY);
      progress = {}; home();
    }
  };

  function sentenceSelection() {
    return SentenceQuiz.selectQuiz(words, SentenceQuiz.loadAttempts(localStorage), SentenceQuiz.loadState(localStorage), Date.now(), progress);
  }

  function updateSentenceHome() {
    var sel = sentenceSelection(), badge = $('sentenceBadge'), prompt = $('sentencePrompt');
    $('btnSentence').classList.toggle('ready', sel.phase === 'ready');
    if (sel.phase === 'ready') {
      badge.textContent = 'Ready';
      badge.classList.remove('hidden');
      prompt.textContent = sel.overdue
        ? 'Still open from last week — fill in the blanks with the words you struggled with.'
        : (sel.built.toughCount ? "Ready — use this week's tough words in a sentence." : "Ready — use this week's words in a sentence.");
    } else if (sel.phase === 'done') {
      badge.textContent = 'Done';
      badge.classList.remove('hidden');
      prompt.textContent = 'Finished this week (' + sel.result.correct + '/' + sel.result.total + '). Next quiz opens ' + sel.dayName + '.';
    } else {
      badge.textContent = '';
      badge.classList.add('hidden');
      prompt.textContent = 'Opens ' + sel.dayName + '. Words you miss, need extra tries on, or answer slowly will be on it.';
    }
    prompt.classList.remove('hidden');
  }

  function sentenceChrome(showQuiz) {
    $('sqCard').classList.toggle('hidden', !showQuiz);
    $('sqEmpty').classList.toggle('hidden', showQuiz);
    $('sentence').querySelector('.topbar').classList.toggle('hidden', !showQuiz);
    $('sentence').querySelector('.bar').classList.toggle('hidden', !showQuiz);
  }

  function openSentence() {
    var sel = sentenceSelection();
    if (sel.phase === 'done') { renderSentenceDone(sel.result, sel.id); return; }
    if (sel.phase !== 'ready') {
      sentenceChrome(false);
      $('sqEmptyMsg').textContent = 'Do your cards during the week. On ' + sel.dayName +
        ', this quiz uses the words you missed, needed extra tries on, or answered slowly. Other words from that week fill in if there are not enough.';
      show('sentence');
      return;
    }
    sq = { id: sel.id, items: sel.built.items, i: 0, results: [] };
    sqLocked = false;
    sentenceChrome(true);
    show('sentence');
    renderSentenceItem();
  }

  function renderSentenceItem() {
    var item = sq.items[sq.i], n = sq.items.length;
    sqLocked = false;
    $('sqProgress').textContent = 'Question ' + (sq.i + 1) + ' of ' + n;
    $('sqBar').style.width = (sq.i / n * 100) + '%';
    $('sqPrompt').textContent = item.fallback ? 'Which word matches this meaning?' : 'Which word fits the blank?';
    if (item.fallback) {
      $('sqSentence').innerHTML = '<span class="blank" aria-label="blank"></span>';
      $('sqClue').textContent = 'It means: ' + item.clue;
      $('sqClue').classList.remove('hidden');
    } else {
      var bits = item.sentence.split(SentenceQuiz.BLANK);
      $('sqSentence').innerHTML = esc(bits[0]) + '<span class="blank" aria-label="blank"></span>' + esc(bits[1]);
      $('sqClue').classList.add('hidden');
    }
    $('sqInput').value = '';
    $('sqInput').disabled = false;
    $('sqInput').classList.remove('hidden');
    $('sqCheck').disabled = false;
    $('sqCheck').classList.remove('hidden');
    $('sqBankLabel').classList.remove('hidden');
    $('sqFeedback').classList.add('hidden');
    $('sqNext').textContent = sq.i === n - 1 ? 'See my score →' : 'Next →';
    var bank = $('sqBank');
    bank.innerHTML = '';
    SRS.shuffle(sq.items.map(function (it) { return it.word; })).forEach(function (word) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = word.toLowerCase();
      b.dataset.word = word;
      b.onclick = function () {
        if (sqLocked) return;
        $('sqInput').value = word.toLowerCase();
        Array.prototype.forEach.call(bank.children, function (c) { c.classList.toggle('picked', c === b); });
      };
      bank.appendChild(b);
    });
  }

  function checkSentence() {
    if (!sq || sqLocked) return;
    var item = sq.items[sq.i], typed = $('sqInput').value;
    if (!SentenceQuiz.normalizeAnswer(typed)) {
      $('sqCard').classList.add('shake');
      setTimeout(function () { $('sqCard').classList.remove('shake'); }, 400);
      return;
    }
    sqLocked = true;
    var ok = SentenceQuiz.answersMatch(typed, item.word);
    sq.results.push({ key: item.key, word: item.word, ok: ok, definition: item.definition });
    $('sqInput').disabled = true;
    $('sqInput').classList.add('hidden');
    $('sqCheck').disabled = true;
    $('sqCheck').classList.add('hidden');
    $('sqBankLabel').classList.add('hidden');
    var norm = SentenceQuiz.normalizeAnswer(typed);
    Array.prototype.forEach.call($('sqBank').children, function (c) {
      c.disabled = true;
      var same = SentenceQuiz.normalizeAnswer(c.dataset.word) === norm;
      if (c.dataset.word === item.word) c.classList.add('correct');
      else if (same) c.classList.add('wrong');
    });
    if (!ok) {
      $('sqCard').classList.add('shake');
      setTimeout(function () { $('sqCard').classList.remove('shake'); }, 400);
    }
    var cheers = ['Correct! ✅', 'Nailed it! 💪', 'Yes! 🔥', 'Nice! 🎯'];
    $('sqVerdict').textContent = ok ? cheers[Math.floor(Math.random() * cheers.length)] : 'Not quite — the word is "' + item.word.toLowerCase() + '".';
    $('sqVerdict').className = 'verdict ' + (ok ? 'ok' : 'bad');
    if (item.sentence) {
      var bits = item.sentence.split(SentenceQuiz.BLANK);
      var showWord = item.sentence.indexOf(SentenceQuiz.BLANK) === 0
        ? item.word.charAt(0) + item.word.slice(1).toLowerCase()
        : item.word.toLowerCase();
      $('sqFilled').innerHTML = esc(bits[0]) + '<b>' + esc(showWord) + '</b>' + esc(bits[1]);
    } else $('sqFilled').textContent = '';
    $('sqMeaning').textContent = item.word.toLowerCase() + ': ' + item.definition;
    $('sqExample').textContent = item.example;
    $('sqFeedback').classList.remove('hidden');
    $('sqNext').focus({ preventScroll: true });
    $('sqFeedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function nextSentence() {
    if (!sq || !sqLocked) return;
    sq.i += 1;
    if (sq.i >= sq.items.length) finishSentence();
    else renderSentenceItem();
  }

  function deliverQuizLog(result) {
    if (sessionStorage.getItem('sentence-quiz-dry-run') === '1') return Promise.resolve(wlog.quizPayload(result));
    return wlog.sendQuiz(result);
  }

  function sendSentenceLog(id, result) {
    if (sqSending) return;
    sqSending = true;
    $('sqResend').classList.add('hidden');
    $('sqLog').textContent = 'Sending the log…';
    $('sqLog').classList.remove('hidden');
    $('sqLog').classList.remove('err');
    deliverQuizLog(result).then(function () {
      SentenceQuiz.setEmailed(localStorage, id, true);
      $('sqLog').textContent = '🎉 Quiz logged for ' + wlog.etDate() + '.';
      $('sqLog').classList.remove('err');
    }).catch(function () {
      $('sqLog').textContent = "Score saved. The log email didn't send — check the internet and try again.";
      $('sqLog').classList.add('err');
      $('sqResend').classList.remove('hidden');
    }).then(function () { sqSending = false; });
  }

  function renderSentenceDone(row, id) {
    sqDone = { id: id, row: row };
    var pct = row.total ? row.correct / row.total : 0;
    $('sqScore').textContent = row.correct + ' / ' + row.total;
    $('sqEmoji').textContent = pct >= 0.9 ? '🏆' : pct >= 0.7 ? '🎉' : pct >= 0.5 ? '👍' : '💪';
    $('sqTitle').textContent = pct >= 0.9 ? 'Outstanding!' : pct >= 0.7 ? 'Nice work!' : pct >= 0.5 ? 'Solid effort!' : 'Keep grinding!';
    var missed = row.missed || [];
    $('sqMsg').textContent = missed.length ? 'Missed words were added to Review missed words.' : 'Every sentence right!';
    $('sqMissed').innerHTML = missed.length ? '<ul class="missedlist">' + missed.map(function (word) {
      var w = words.find(function (x) { return x.word === word; });
      return '<li><b>' + esc(String(word).toLowerCase()) + '</b>' + (w ? ' — ' + esc(w.definition) : '') + '</li>';
    }).join('') + '</ul>' : '';
    $('sqReview').classList.toggle('hidden', SRS.reviewWords(words, progress).length === 0);
    $('sqLog').classList.add('hidden');
    $('sqResend').classList.add('hidden');
    show('sentenceDone');
    if (row.emailed) {
      $('sqLog').textContent = 'Logged for ' + wlog.etDate() + '.';
      $('sqLog').classList.remove('hidden', 'err');
      return;
    }
    sendSentenceLog(id, { correct: row.correct, total: row.total, missed: missed, weekOf: id });
  }

  function finishSentence() {
    var results = sq.results, correct = results.filter(function (r) { return r.ok; }).length;
    var missed = results.filter(function (r) { return !r.ok; });
    var id = sq.id;
    $('sqBar').style.width = '100%';
    var saved = SentenceQuiz.markComplete(localStorage, id, {
      correct: correct, total: results.length,
      missed: missed.map(function (r) { return r.word; }),
      missedKeys: missed.map(function (r) { return r.key; })
    });
    if (saved.fresh) {
      missed.forEach(function (r) {
        SRS.record(progress, r.key, false);
        // A quiz miss counts toward next week's tough-word list and toward Review.
        SentenceQuiz.recordAttempt(localStorage, { key: r.key, ok: false, ms: 0 });
      });
      SRS.save(localStorage, progress);
    }
    sq = null;
    renderSentenceDone(saved.row, id);
  }

  // Local sample week only: http://127.0.0.1:PORT/#simweek  (never on the public site, and it does not email).
  function maybeSimWeek() {
    var host = location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return;
    if (location.hash !== '#simweek') return;
    var attempts = SentenceQuiz.demoWeekAttempts(words, Date.now());
    localStorage.setItem(SentenceQuiz.ATTEMPT_KEY, JSON.stringify({ attempts: attempts }));
    sessionStorage.setItem('sentence-quiz-dry-run', '1');
    history.replaceState(null, '', location.pathname + location.search);
  }

  $('btnSentence').onclick = openSentence;
  $('sqQuit').onclick = home;
  $('sqEmptyHome').onclick = home;
  $('sqHome').onclick = home;
  $('sqCheck').onclick = checkSentence;
  $('sqNext').onclick = nextSentence;
  $('sqResend').onclick = function () {
    if (!sqDone) return;
    sendSentenceLog(sqDone.id, { correct: sqDone.row.correct, total: sqDone.row.total, missed: sqDone.row.missed || [], weekOf: sqDone.id });
  };
  $('sqReview').onclick = function () { start('review'); };
  $('sqInput').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!sqLocked) checkSentence(); else nextSentence();
  });
  $('sqInput').addEventListener('input', function () {
    var v = SentenceQuiz.normalizeAnswer($('sqInput').value);
    Array.prototype.forEach.call($('sqBank').children, function (c) {
      c.classList.toggle('picked', !!v && SentenceQuiz.normalizeAnswer(c.dataset.word) === v);
    });
  });

  fetch('words.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) { words = data; maybeSimWeek(); home(); })
    .catch(function () { $('homeSummary').textContent = 'Could not load words.json — check your connection and refresh.'; });
})();
