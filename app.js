(function () {
  var $ = function (id) { return document.getElementById(id); };
  var K = SRS.key;
  var words = [], progress = SRS.load(localStorage), session = null, answered = false;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var MODES = { today: "📅 Today's set", review: '🔁 Review missed', all: '🎲 Mix', synonym: '🟰 Synonyms', antonym: '↔️ Antonyms' };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function show(id) {
    ['home', 'quiz', 'done', 'stats'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
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
    if (first) { SRS.record(progress, k, ok); SRS.save(localStorage, progress); }
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

  function home() { refreshHome(); show('home'); }

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
    if (confirm("Erase all of Vince's progress on this device? This can't be undone.")) {
      SRS.reset(localStorage); progress = {}; home();
    }
  };

  fetch('words.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) { words = data; home(); })
    .catch(function () { $('homeSummary').textContent = 'Could not load words.json — check your connection and refresh.'; });
})();
