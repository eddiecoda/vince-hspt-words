// Headless checks: node test.js
const assert = require('assert');
const fs = require('fs');
const SRS = require('./srs.js');
const words = JSON.parse(fs.readFileSync(__dirname + '/words.json', 'utf8'));
const K = SRS.key;

// words.json schema
const seen = new Set();
for (const w of words) {
  assert(/^[A-Z][A-Z \-']*$/.test(w.word), 'stem must be capitalized: ' + w.word);
  assert(['synonym', 'antonym'].includes(w.type), 'bad type ' + w.word);
  assert(!seen.has(K(w)), 'duplicate card ' + K(w)); seen.add(K(w));
  assert(Array.isArray(w.choices) && w.choices.length === 4, '4 choices ' + w.word);
  assert(new Set(w.choices.map(c => c.toLowerCase())).size === 4, 'distinct choices ' + w.word);
  assert(w.choices.filter(c => c === w.answer).length === 1, 'exactly one answer in choices ' + w.word);
  assert(!w.choices.some(c => c.toLowerCase() === w.word.toLowerCase()), 'stem not a choice ' + w.word);
  assert(w.definition && w.example, 'definition/example ' + w.word);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(w.addedDate), 'addedDate ' + w.word);
  // sentence: one blank (_____) , base-form context, word itself not included.
  // See the comment at the top of sentencequiz.js. Missing sentences are allowed
  // by the quiz (it falls back to the definition) but every card shipped here has one.
  assert(typeof w.sentence === 'string' && w.sentence.split('_____').length === 2, 'one _____ blank ' + w.word);
  assert(!w.sentence.toLowerCase().includes(w.word.toLowerCase()), 'sentence contains the word ' + w.word);
  assert(!new RegExp('\\b' + w.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(w.sentence), 'sentence gives away the answer ' + w.word);
  assert(w.sentence.split(/\s+/).length >= 8, 'sentence too short ' + w.word);
  var blankedExample = w.example.replace(new RegExp(w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '_____');
  assert(w.sentence !== blankedExample, 'sentence should not be the example with a blank ' + w.word);
}
const used = fs.readFileSync(__dirname + '/used_words.txt', 'utf8').split(/\s+/).filter(Boolean);
for (const w of words) assert(used.includes(w.word), 'missing from used_words.txt: ' + w.word);
const lukeFile = '/workspace/luke-isee-synonyms/used_words.txt';
if (fs.existsSync(lukeFile)) {
  const luke = new Set(fs.readFileSync(lukeFile, 'utf8').split(/\s+/));
  for (const w of words) assert(!luke.has(w.word), "reuses Luke's word " + w.word);
}
const nSyn = words.filter(w => w.type === 'synonym').length, nAnt = words.filter(w => w.type === 'antonym').length;
console.log('words.json OK:', words.length, 'cards,', nSyn, 'synonym,', nAnt, 'antonym');

// Same word as both types is tracked separately
const both = [{ word: 'ZEST', type: 'synonym', choices: ['a','b','c','d'], answer: 'a', definition: 'x', example: 'y', addedDate: '2099-01-01' },
              { word: 'ZEST', type: 'antonym', choices: ['a','b','c','d'], answer: 'b', definition: 'x', example: 'y', addedDate: '2099-01-01' }];
const pz = {};
SRS.record(pz, K(both[0]), true, 0); SRS.record(pz, K(both[1]), false, 0);
assert.strictEqual(pz['ZEST:synonym'].correct, 1); assert.strictEqual(pz['ZEST:antonym'].correct, 0);
assert.deepStrictEqual(SRS.reviewWords(both, pz, 0).map(K), ['ZEST:antonym']);

// Today's batch picks the newest date
const extra = words.concat(both);
assert.strictEqual(SRS.todaysWords(extra, '2099-06-01').length, 2);
assert.strictEqual(SRS.todaysWords(words, '2026-10-18').length, words.filter(w => w.addedDate === '2026-10-18').length);

// Spaced repetition
const D = SRS.DAY; const t0 = Date.UTC(2026, 9, 18, 15); const p = {};
const a = words.find(w => w.word === 'TEDIOUS'), b = words.find(w => w.word === 'HUMBLE');
SRS.record(p, K(a), false, t0);
assert.strictEqual(p[K(a)].box, 0); assert.strictEqual(p[K(a)].due, t0);
assert.deepStrictEqual(SRS.reviewWords(words, p, t0).map(K), [K(a)], 'missed card is in review');
SRS.record(p, K(b), true, t0);
assert(!SRS.reviewWords(words, p, t0).includes(b), 'right card not due today');
assert(SRS.reviewWords(words, p, t0 + D).includes(b), 'right card due tomorrow');
SRS.record(p, K(b), true, t0 + D); SRS.record(p, K(b), true, t0 + 3 * D);
assert(SRS.isMastered(p[K(b)]), 'mastered after 3 in a row');
assert.strictEqual(p[K(b)].due - (t0 + 3 * D), 4 * D, 'mastered cards wait longer');
SRS.record(p, K(b), false, t0 + 8 * D);
assert(!SRS.isMastered(p[K(b)]) && p[K(b)].box === 0, 'miss resets mastery');
assert.strictEqual(p[K(b)].seen, 4); assert.strictEqual(p[K(b)].correct, 3); assert.strictEqual(p[K(b)].lastSeen, t0 + 8 * D);

// Stats
const st = SRS.stats(words, p);
assert.strictEqual(st.answered, 5); assert.strictEqual(st.correct, 3); assert.strictEqual(st.tough[0].key, K(a));

// Session: a miss is re-queued once, first-try score only
const s = new SRS.Session(words.slice(0, 5));
const first = s.current(); s.answer(false);
assert.strictEqual(s.queue[3], first, 'missed card comes back 3 cards later');
while (!s.finished()) s.answer(true);
assert.strictEqual(s.done, 5); assert.strictEqual(s.right, 4);

// localStorage round trip, own key
assert.strictEqual(SRS.STORE_KEY, 'vince-hspt-progress-v1');
const mem = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
SRS.save(mem, p); assert.deepStrictEqual(SRS.load(mem), p); SRS.reset(mem); assert.deepStrictEqual(SRS.load(mem), {});
console.log('All SRS tests passed');

// Sentence quiz: Mon, Wed, Fri (ET)
const SQ = require('./sentencequiz.js');
assert.deepStrictEqual(SQ.QUIZ_DAYS, [1, 3, 5], 'Mon, Wed, Fri; change QUIZ_DAYS and these comments together');
assert.ok(SQ.QUIZ_MIN >= 10 && SQ.QUIZ_MAX <= 15 && SQ.QUIZ_MIN <= SQ.QUIZ_MAX);
words.forEach(w => assert.strictEqual(SQ.key(w), K(w), 'quiz keys match SRS ' + w.word));

// Quiz id = the most recent quiz day in Eastern Time; the window is since the previous quiz day.
const thu = Date.parse('2026-10-29T15:00:00Z'); // Thu Oct 29, 2026, 11:00 ET
assert.strictEqual(SQ.unlockId(thu), '2026-10-28', 'Thursday belongs to Wednesday\'s quiz');
assert.strictEqual(SQ.unlockId(Date.parse('2026-10-26T15:00:00Z')), '2026-10-26', 'Monday');
assert.strictEqual(SQ.unlockId(Date.parse('2026-10-27T15:00:00Z')), '2026-10-26', 'Tuesday is still Monday\'s quiz');
assert.strictEqual(SQ.unlockId(Date.parse('2026-10-30T15:00:00Z')), '2026-10-30', 'Friday');
assert.strictEqual(SQ.unlockId(Date.parse('2026-10-31T15:00:00Z')), '2026-10-30', 'Saturday is Friday\'s quiz');
assert.strictEqual(SQ.unlockId(Date.parse('2026-11-01T15:00:00Z')), '2026-10-30', 'Sunday is Friday\'s quiz');
assert.strictEqual(SQ.etParts(new Date(SQ.etMidnight('2026-10-28'))).weekday, 'Wed');
assert.strictEqual(SQ.unlockId(SQ.etMidnight('2026-10-28') - 1000), '2026-10-26', 'just before Wednesday is Monday\'s quiz');
assert.strictEqual(SQ.unlockId(SQ.etMidnight('2026-10-28') + 30 * 60 * 1000), '2026-10-28');
assert.strictEqual(SQ.prevQuizId('2026-10-28'), '2026-10-26');
assert.strictEqual(SQ.prevQuizId('2026-10-30'), '2026-10-28');
assert.strictEqual(SQ.prevQuizId('2026-11-02'), '2026-10-30', 'Monday looks back to Friday');
assert.deepStrictEqual(SQ.nextQuizDay(Date.parse('2026-10-26T15:00:00Z')), { id: '2026-10-28', dayName: 'Wednesday' });
assert.deepStrictEqual(SQ.nextQuizDay(thu), { id: '2026-10-30', dayName: 'Friday' });
assert.deepStrictEqual(SQ.nextQuizDay(Date.parse('2026-10-31T15:00:00Z')), { id: '2026-11-02', dayName: 'Monday' });
const win = SQ.quizWindow('2026-10-28');
assert.strictEqual(win.start, SQ.etMidnight('2026-10-26'), 'window starts at the previous quiz day');
assert.strictEqual(win.end, SQ.etMidnight('2026-10-28'));
assert.strictEqual(SQ.weekWindow, SQ.quizWindow, 'old name kept');
const monWin = SQ.quizWindow('2026-11-02');
assert.strictEqual(monWin.start, SQ.etMidnight('2026-10-30'), 'Monday\'s window starts Friday');
// DST ends Nov 1, 2026; midnight Eastern is still a real instant.
assert.strictEqual(SQ.etParts(new Date(SQ.etMidnight('2026-11-02'))).hour, '00');
assert.strictEqual(SQ.unlockId(Date.parse('2026-11-02T04:30:00Z')), '2026-10-30', 'Sunday 11:30 PM EST is still Friday\'s quiz');
assert.strictEqual(SQ.unlockId(Date.parse('2026-11-02T05:30:00Z')), '2026-11-02', 'Monday 12:30 AM EST');

assert.strictEqual(SQ.answersMatch('  Elated ', 'ELATED'), true);
assert.strictEqual(SQ.answersMatch('elated', 'ELATED'), true);
assert.strictEqual(SQ.answersMatch('ELATED', 'elated'), true);
assert.strictEqual(SQ.answersMatch('e lated', 'ELATED'), false);
assert.strictEqual(SQ.answersMatch('elated!', 'ELATED'), false);
assert.strictEqual(SQ.normalizeAnswer('  A   B '), 'a b');

// No sentence -> definition clue. A sentence that still contains the word is ignored.
const bare = { word: 'ZEST', type: 'synonym', definition: 'lively energy', example: 'x', addedDate: '2099-01-01' };
assert.strictEqual(SQ.usableSentence(bare), '');
assert.strictEqual(SQ.usableSentence(Object.assign({}, bare, { sentence: 'Full of _____ after the win.' })), 'Full of _____ after the win.');
assert.strictEqual(SQ.usableSentence(Object.assign({}, bare, { sentence: 'Full of zest _____.' })), '');
const builtBare = SQ.buildQuiz([bare], [{ t: win.start + 1000, key: 'ZEST:synonym', ok: false, ms: 1000 }], '2026-10-28');
assert.strictEqual(builtBare.items[0].fallback, true);
assert.strictEqual(builtBare.items[0].clue, 'lively energy');

// Simulated window: misses, several tries, and a slow answer, then top-up from the other words.
const demoStore = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const before = JSON.stringify(SRS.load(demoStore));
const demoAttempts = SQ.demoWeekAttempts(words, thu);
demoAttempts.forEach(a => SQ.recordAttempt(demoStore, a, thu));
assert.strictEqual(JSON.stringify(SRS.load(demoStore)), before, 'attempt log does not touch SRS progress');
assert.notStrictEqual(SQ.ATTEMPT_KEY, SRS.STORE_KEY);
assert.strictEqual(SQ.loadAttempts(demoStore).length, demoAttempts.length);
// Just outside the window must not change this quiz. (The earlier one belongs to the previous quiz.)
const demo = SQ.buildQuiz(words, SQ.loadAttempts(demoStore).concat([
  { t: win.start - 1, key: K(words[0]), ok: false, ms: 1000 },
  { t: win.end, key: K(words[1]), ok: false, ms: 1000 }
]), '2026-10-28');
assert.deepStrictEqual(demo.items.map(i => i.word), [
  'TEDIOUS', 'CONCISE', 'HUMBLE', 'BRITTLE', 'ELATED', 'FEASIBLE', 'HOSTILE', 'ADEQUATE', 'DISMAL', 'FRUGAL'
]);
assert.strictEqual(demo.toughCount, 7);
assert.strictEqual(demo.fillerCount, 3);
assert.ok(demo.items[0].score > demo.items[1].score, 'worst first');
assert.strictEqual(demo.items.every(i => i.sentence && !i.fallback), true);
// 20 tough words cap at 15; 4 tough words get topped up to 10; slow boundary is inclusive.
function attempt(word, ok, ms, t) { return { t: t, key: K(words.find(w => w.word === word)), ok: ok, ms: ms }; }
const many = words.slice(0, 20).map(w => attempt(w.word, false, 1000, win.start + 5000));
assert.strictEqual(SQ.buildQuiz(words, many, '2026-10-28').items.length, 15);
const fewTough = [attempt('TEDIOUS', false, 1000, win.start + 5000), attempt('ADEQUATE', true, 1000, win.start + 6000),
  attempt('BRITTLE', true, 1000, win.start + 7000), attempt('DISMAL', true, 1000, win.start + 8000)];
assert.strictEqual(SQ.buildQuiz(words, fewTough, '2026-10-28').items[0].word, 'TEDIOUS');
assert.strictEqual(SQ.buildQuiz(words, fewTough, '2026-10-28').items.length, 4);
const topped = fewTough.concat(words.slice(2, 12).map(w => attempt(w.word, true, 1000, win.start + 9000)));
const toppedQuiz = SQ.buildQuiz(words, topped, '2026-10-28');
assert.strictEqual(toppedQuiz.items.length, 10);
assert.strictEqual(toppedQuiz.items[0].word, 'TEDIOUS');
assert.strictEqual(toppedQuiz.toughCount, 1);
assert.strictEqual(SQ.buildQuiz(words, [attempt('HOSTILE', true, SQ.SLOW_MS, win.start + 5000)], '2026-10-28').items[0].tough, true);
assert.strictEqual(SQ.buildQuiz(words, [attempt('HOSTILE', true, SQ.SLOW_MS - 1, win.start + 5000)], '2026-10-28').items[0].tough, false);
// Three correct showings are not "several tries". Three attempts with a miss are.
const calm = [1, 1, 1].map((ok, i) => attempt('PLACID', true, 1000, win.start + 1000 * (i + 1)));
assert.strictEqual(SQ.buildQuiz(words, calm, '2026-10-28').items[0].tough, false);
const several = [attempt('PLACID', false, 1000, win.start + 1000), attempt('PLACID', false, 1000, win.start + 2000), attempt('PLACID', true, 1000, win.start + 3000)];
assert.strictEqual(SQ.buildQuiz(words, several, '2026-10-28').items[0].tough, true);

// Backfill from existing progress when that card was touched in the window but has no timed attempts.
const backProgress = {};
SRS.record(backProgress, K(words.find(w => w.word === 'RIGID')), false, win.start + 8000);
SRS.record(backProgress, K(words.find(w => w.word === 'PLACID')), true, win.start + 9000);
SRS.record(backProgress, K(words.find(w => w.word === 'ZEALOUS')), false, win.start - 10);
const back = SQ.buildQuiz(words, [], '2026-10-28', backProgress);
assert.deepStrictEqual(back.items.map(i => i.word), ['RIGID', 'PLACID']);
assert.strictEqual(back.items[0].tough, true);
assert.strictEqual(back.items[1].tough, false);
// A timed attempt wins over the saved last result so a later correct answer does not hide an earlier miss.
const mixed = SQ.buildQuiz(words, [attempt('RIGID', false, 1000, win.start + 1000), attempt('RIGID', true, 1000, win.start + 2000)], '2026-10-28', backProgress);
assert.strictEqual(mixed.items[0].tough, true);

// Short window: fewer than 10 tough words tops up with recent words (current set, then previous set), least known first.
const curSet = words.slice(40, 60), prevSet = words.slice(20, 40);
const recentP = {};
SRS.record(recentP, K(curSet[2]), true, win.start - 5 * 86400000); SRS.record(recentP, K(curSet[2]), true, win.start - 4 * 86400000);
const shortQ = SQ.buildQuiz(words, [attempt('TEDIOUS', false, 1000, win.start + 5000)], '2026-10-28', recentP, curSet.concat(prevSet));
assert.strictEqual(shortQ.items.length, 10);
assert.strictEqual(shortQ.items[0].word, 'TEDIOUS');
assert.strictEqual(shortQ.toughCount, 1);
const expectRecent = curSet.filter((w, i) => i !== 2 && w.word !== 'TEDIOUS').slice(0, 9).map(w => w.word);
assert.deepStrictEqual(shortQ.items.slice(1).map(i => i.word), expectRecent, 'current set first, known card pushed back');
assert.strictEqual(new Set(shortQ.items.map(i => i.word.toLowerCase())).size, 10, 'no duplicate words');
const tinyQ = SQ.buildQuiz(words, [], '2026-10-28', {}, curSet.slice(0, 3).concat(prevSet));
assert.deepStrictEqual(tinyQ.items.map(i => i.key), curSet.slice(0, 3).concat(prevSet).filter((w, i, arr) => arr.findIndex(x => x.word.toLowerCase() === w.word.toLowerCase()) === i).slice(0, 10).map(K), 'previous set fills in after the current set');
assert.strictEqual(SQ.buildQuiz(words, [], '2026-10-28', {}).items.length, 0, 'no recent words, no practice: empty');

// Opens on each quiz day and stays open until finished. A newer quiz day replaces an unfinished older quiz.
const emptyState = { byWeek: {} };
const ready = SQ.selectQuiz(words, SQ.loadAttempts(demoStore), emptyState, thu);
assert.strictEqual(ready.phase, 'ready');
assert.strictEqual(ready.id, '2026-10-28');
assert.strictEqual(ready.built.items.length, 10);
assert.strictEqual(ready.dayName, 'Friday');
const doneState = { byWeek: { '2026-10-28': { correct: 8, total: 10, missed: ['TEDIOUS'], emailed: true } } };
const doneSel = SQ.selectQuiz(words, SQ.loadAttempts(demoStore), doneState, thu);
assert.strictEqual(doneSel.phase, 'done');
assert.strictEqual(doneSel.dayName, 'Friday', 'The next one opens Friday');
assert.strictEqual(SQ.selectQuiz(words, [], emptyState, thu).phase, 'empty');
assert.strictEqual(SQ.selectQuiz(words, [], emptyState, thu, {}, curSet).phase, 'ready', 'recent words keep a quiet window from being empty');
// Monday's quiz still open on Tuesday.
const monAttempts = [attempt('LAX', false, 1000, SQ.etMidnight('2026-10-23') + 5000)];
const tue = SQ.selectQuiz(words, monAttempts, emptyState, Date.parse('2026-10-27T15:00:00Z'));
assert.strictEqual(tue.phase, 'ready'); assert.strictEqual(tue.id, '2026-10-26');
// Unfinished Monday quiz is replaced on Wednesday by Wednesday's quiz.
const wedAttempts = monAttempts.concat([attempt('HUMBLE', false, 1000, SQ.etMidnight('2026-10-27') + 5000)]);
const wed = SQ.selectQuiz(words, wedAttempts, emptyState, SQ.etMidnight('2026-10-28') + 60 * 1000);
assert.strictEqual(wed.phase, 'ready');
assert.strictEqual(wed.id, '2026-10-28', 'newer quiz replaces the unfinished one');
assert.strictEqual(wed.overdue, false);
assert.deepStrictEqual(wed.built.items.map(i => i.word), ['HUMBLE'], 'only the Mon–Tue window');
// Finished Monday, nothing new yet on Wednesday: stays done, says Friday next.
const afterPrev = SQ.selectQuiz(words, monAttempts, { byWeek: { '2026-10-26': { correct: 0, total: 1, missed: ['LAX'] } } }, SQ.etMidnight('2026-10-28') + 60 * 1000);
assert.strictEqual(afterPrev.phase, 'done', 'finished quiz stays done until the new window has words');
assert.strictEqual(afterPrev.id, '2026-10-26');
assert.strictEqual(afterPrev.dayName, 'Friday');
assert.strictEqual(afterPrev.result.missed[0], 'LAX');
// Old weekly state (a Sunday id) does not block the new quiz.
assert.strictEqual(SQ.selectQuiz(words, SQ.loadAttempts(demoStore), { byWeek: { '2026-10-25': { correct: 9, total: 10 } } }, thu).phase, 'ready');

// Quiz miss feeds review weighting, and completion is stored once.
const quizMem = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const qp = {};
const tedious = words.find(w => w.word === 'TEDIOUS');
const marked = SQ.markComplete(quizMem, '2026-10-28', { correct: 0, total: 1, missed: ['TEDIOUS'], missedKeys: [K(tedious)], at: thu });
assert.strictEqual(marked.fresh, true);
SRS.record(qp, K(tedious), false, thu);
assert.strictEqual(qp[K(tedious)].lastResult, 'wrong');
assert.deepStrictEqual(SRS.reviewWords([tedious], qp, thu).map(K), [K(tedious)]);
assert.strictEqual(SQ.markComplete(quizMem, '2026-10-28', { correct: 1, total: 1, missed: [] }).fresh, false, 'finishing twice does not reset the score');
SQ.setEmailed(quizMem, '2026-10-28', true);
assert.strictEqual(SQ.loadState(quizMem).byWeek['2026-10-28'].emailed, true);
console.log('Sentence quiz tests passed');

// Coda Stars quiz_completed POST: payload shape, text/plain, fire-and-forget (fetch is mocked; no real network).
(async () => {
  const ev = SQ.quizEvent('vince', '2026-10-28', 8, 10, '2026-10-29');
  assert.deepStrictEqual(ev, { kid: 'vince', event: 'quiz_completed', quiz_id: '2026-10-28', correct: 8, total: 10, date_et: '2026-10-29' });
  const calls = [];
  assert.strictEqual(await SQ.postQuizEvent((u, o) => { calls.push([u, o]); return Promise.resolve({ ok: true }); }, ev), true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'https://coda-kids-app.vercel.app/api/vocab/event');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(calls[0][1].headers['Content-Type'].split(';')[0], 'text/plain');
  assert.deepStrictEqual(JSON.parse(calls[0][1].body), ev);
  assert.strictEqual(await SQ.postQuizEvent(() => Promise.resolve({ ok: false, status: 400 }), ev), false, '400 until the server deploys is fine');
  assert.strictEqual(await SQ.postQuizEvent(() => Promise.reject(new TypeError('Failed to fetch')), ev), false, 'network error swallowed');
  assert.strictEqual(await SQ.postQuizEvent(() => { throw new Error('boom'); }, ev), false, 'sync throw swallowed');
  assert.strictEqual(await SQ.postQuizEvent(null, ev), false, 'no fetch');
  const appSrc = fs.readFileSync(__dirname + '/app.js', 'utf8');
  assert(/SentenceQuiz\.postQuizEvent\([\s\S]{0,120}SentenceQuiz\.quizEvent\(KID, id, correct, results\.length, WordLog\.etDate\(\)\)\)\.catch\(/.test(appSrc), 'app posts quiz_completed fire-and-forget');
  assert(!/await\s+SentenceQuiz\.postQuizEvent/.test(appSrc));
  const fin = appSrc.slice(appSrc.indexOf('function finishSentence'));
  assert(fin.indexOf('if (saved.fresh)') < fin.indexOf('postQuizEvent('), 'posted once, on the first finish');
  assert(fin.indexOf('sentence-quiz-dry-run') < fin.indexOf('postQuizEvent('), 'dry run skips the post');
  assert(fin.indexOf('renderSentenceDone(saved.row, id)') > fin.indexOf('postQuizEvent('), 'FormSubmit quiz log still sent after');
  console.log('Quiz Coda Stars event tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// Daily words log (wordlog.js): cumulative per-day record, de-duplicated sends
(async () => {
  const WL = require('./wordlog.js');
  const store = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
  const sent = [];
  const fakeFetch = (u, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({ json: () => ({ success: 'true' }) }); };
  const set = SRS.todaysWords(words, '2099-01-01'), keyFn = SRS.key || (w => w.word);
  const log = WL.create({ kid: 'Test', storage: store, keyFn, setFn: () => set, fetch: fakeFetch, now: () => new Date('2026-10-26T02:30:00Z') });
  assert.strictEqual(log.etDate(), '2026-10-25', 'ET date, not UTC');
  await log.flush(); assert.strictEqual(sent.length, 0, 'nothing sent before the set is opened');
  log.openedSet(); await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].opened_set, 'yes'); assert.strictEqual(sent[0].answered, 0);
  log.openedSet(); await log.flush(); assert.strictEqual(sent.length, 1, 'no duplicate when nothing changed');
  set.forEach((w, i) => { log.answered(keyFn(w), i % 4 !== 0); log.answered(keyFn(w), true); });
  await new Promise(r => setTimeout(r, 0)); await log.flush();
  assert.strictEqual(sent.length, 2, 'one send on completing the set');
  const last = sent[1];
  assert.strictEqual(last.answered, set.length); assert.strictEqual(last.right, set.length - Math.ceil(set.length / 4));
  assert.strictEqual(last.completed_all, 'yes'); assert.strictEqual(last.source, 'auto'); assert.strictEqual(last.kid, 'Test');
  log.answered('NOT-IN-SET', true); assert(!('NOT-IN-SET' in log.state().firstTry), 'older words are not counted');
  await log.button(); assert.strictEqual(sent[2].source, 'button'); assert(log.buttonDone());
  const dailySig = log.state().sentSig, dailyButton = log.buttonDone();
  const quizSent = await log.sendQuiz({ correct: 8, total: 10, missed: ['TEDIOUS', 'HUMBLE'], weekOf: '2026-10-25' });
  assert.strictEqual(quizSent._subject, 'WORDS LOG Test 2026-10-25 quiz');
  assert.strictEqual(quizSent.source, 'quiz');
  assert.strictEqual(quizSent.score, '8/10');
  assert.strictEqual(quizSent.correct, 8);
  assert.strictEqual(quizSent.total, 10);
  assert.strictEqual(quizSent.missed, 'TEDIOUS, HUMBLE');
  assert.strictEqual(quizSent.week_of, '2026-10-25');
  assert.strictEqual(quizSent.kid, 'Test');
  assert.strictEqual(quizSent.date_et, '2026-10-25');
  assert.strictEqual(sent[3]._subject, quizSent._subject);
  assert.strictEqual(log.state().sentSig, dailySig, 'quiz send does not change the daily log');
  assert.strictEqual(log.buttonDone(), dailyButton);
  const none = WL.quizRecord('Vince', '2026-10-29', '4:05 PM ET', { correct: 10, total: 10, missed: [], weekOf: '2026-10-25' });
  assert.strictEqual(none._subject, 'WORDS LOG Vince 2026-10-29 quiz');
  assert.strictEqual(none.missed, 'none');
  assert.strictEqual(none.score, '10/10');
  console.log('Words log tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// ---- Word sets: schema, set advance, bank exhausted, Coda Stars hook ----
(async () => {
  const KF = SRS.key || (w => w.word);
  const PFX = SRS.STORE_KEY.indexOf('luke') === 0 ? 'L' : 'V';
  const orderOf = {};
  for (const w of words) {
    assert(typeof w.set === 'string' && w.set, 'set id ' + w.word);
    assert(Number.isInteger(w.order) && w.order > 0, 'order ' + w.word);
    if (/^\d{4}-\d{2}-\d{2}$/.test(w.set)) assert.strictEqual(w.set, w.addedDate, 'old cards: set = addedDate ' + w.word);
    if (w.set in orderOf) assert.strictEqual(orderOf[w.set], w.order, 'one order per set ' + w.set); else orderOf[w.set] = w.order;
  }
  const list = SRS.setList(words);
  assert.deepStrictEqual(list.map(s => s.order), list.map((s, i) => i + 1), 'orders run 1..N');
  const bank = list.filter(s => /^[LV]-\d{3}$/.test(s.id));
  assert(bank.length >= 10, 'bank of upcoming sets');
  bank.forEach((s, i) => { assert.strictEqual(s.id, PFX + '-' + String(i + 1).padStart(3, '0')); assert.strictEqual(s.cards.length, 20, '20 cards in ' + s.id); });
  assert(list.indexOf(bank[0]) > list.findIndex(s => /^\d{4}/.test(s.id)), 'bank sets come after the dated sets');
  console.log('Sets OK:', list.length, 'sets,', bank.length, 'in the bank (' + bank[0].id + '..' + bank[bank.length - 1].id + ')');

  const mem = () => ({ d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } });
  // Fresh device: current set = newest dated batch (what used to be "Today's set").
  let store = mem(), st = SRS.loadSets(store), pr = {};
  const dated = list.filter(s => /^\d{4}/.test(s.id)), newest = dated[dated.length - 1];
  let r = SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(r.set.id, newest.id); assert(!r.exhausted);
  assert(!SRS.unlockedWords(words, st, pr, KF).some(w => w.set === bank[0].id), 'bank sets locked until reached');
  // Wrong first try, right on the retry: still counts as answered right once.
  const c0 = newest.cards[0];
  SRS.record(pr, KF(c0), false); assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, c0, false), null);
  assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, c0, true), null);
  assert.strictEqual(SRS.setProgress(newest, st, pr, KF).right, 1);
  // Cards outside the current set don't count toward it.
  assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, bank[1].cards[0], true), null);
  let res = null;
  newest.cards.slice(1).forEach((w, i) => { SRS.record(pr, KF(w), true); const x = SRS.markSetAnswer(words, st, pr, KF, w, true); if (x) { assert(!res, 'completes once'); res = x; assert.strictEqual(i, newest.cards.length - 2, 'completes on the last card'); } });
  assert(res && res.completed); assert.strictEqual(res.from, newest.id); assert.strictEqual(res.to, bank[0].id); assert(!res.exhausted);
  assert.strictEqual(res.right, newest.cards.length); assert.strictEqual(st.notice, 'unlocked');
  SRS.saveSets(store, st); st = SRS.loadSets(store);
  r = SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(r.set.id, bank[0].id, 'advanced to ' + bank[0].id + ' and stored in localStorage');
  assert(SRS.unlockedWords(words, st, pr, KF).some(w => w.set === bank[0].id));
  assert(!SRS.unlockedWords(words, st, pr, KF).some(w => w.set === bank[1].id));
  // Review of older words keeps working: the missed card is still due.
  assert(SRS.reviewWords(SRS.unlockedWords(words, st, pr, KF), pr).some(w => KF(w) === KF(c0)), 'missed word still in review');
  // The daily log keeps reporting the set worked today.
  const st2 = SRS.loadSets(mem()); const pr2 = {};
  assert.strictEqual(SRS.daySet(words, st2, pr2, KF, '2026-11-01')[0].set, newest.id);
  newest.cards.forEach(w => SRS.markSetAnswer(words, st2, pr2, KF, w, true));
  assert.strictEqual(SRS.resolveCurrent(words, st2, pr2, KF).set.id, bank[0].id);
  assert.strictEqual(SRS.daySet(words, st2, pr2, KF, '2026-11-01')[0].set, newest.id, 'same day: still the finished set');
  assert.strictEqual(SRS.daySet(words, st2, pr2, KF, '2026-11-02')[0].set, bank[0].id, 'next day: the new set');
  // Finish every bank set: the last one reports "coming soon" and the app stays on it.
  for (let i = 0; i < bank.length; i++) {
    assert.strictEqual(SRS.resolveCurrent(words, st, pr, KF).set.id, bank[i].id);
    let done = null; bank[i].cards.forEach(w => { const x = SRS.markSetAnswer(words, st, pr, KF, w, true); if (x) done = x; });
    assert(done, 'completed ' + bank[i].id);
    assert.strictEqual(done.to, i + 1 < bank.length ? bank[i + 1].id : null);
    assert.strictEqual(done.exhausted, i + 1 === bank.length);
  }
  assert.strictEqual(st.notice, 'soon');
  r = SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(r.set.id, bank[bank.length - 1].id, 'bank exhausted: stays on the last set'); assert(r.exhausted);
  assert.strictEqual(SRS.markSetAnswer(words, st, pr, KF, bank[bank.length - 1].cards[0], true), null, 'no second completion');
  // A later top-up moves on automatically.
  const extraSet = bank[0].cards.map(w => Object.assign({}, w, { word: 'TOPUP' + w.word, set: PFX + '-999', order: list.length + 1 }));
  r = SRS.resolveCurrent(words.concat(extraSet), st, pr, KF);
  assert.strictEqual(r.set.id, PFX + '-999'); assert(!r.exhausted);
  console.log('Set advance + bank-exhausted tests passed');

  // Coda Stars hook: fire-and-forget, never throws or rejects.
  const calls = [];
  const ok = await SRS.postStarsEvent((u, o) => { calls.push([u, o]); return Promise.resolve({ ok: true }); },
    { kid: 'test', event: 'completed', set: 'X', next_set: 'Y', answered: 20, right: 20, date_et: '2026-10-31' });
  assert.strictEqual(ok, true); assert.strictEqual(calls[0][0], 'https://coda-kids-app.vercel.app/api/vocab/event');
  assert.strictEqual(calls[0][1].method, 'POST'); assert.strictEqual(JSON.parse(calls[0][1].body).event, 'completed');
  assert.strictEqual(await SRS.postStarsEvent(() => Promise.resolve({ ok: false, status: 404 }), {}), false, '404 is fine');
  assert.strictEqual(await SRS.postStarsEvent(() => Promise.reject(new TypeError('Failed to fetch')), {}), false, 'network error swallowed');
  assert.strictEqual(await SRS.postStarsEvent(() => { throw new Error('boom'); }, {}), false, 'sync throw swallowed');
  assert.strictEqual(await SRS.postStarsEvent(null, {}), false, 'no fetch');
  // The daily words log now reports the set id.
  const WL = require('./wordlog.js'); const sent = []; const s3 = mem();
  const lg = WL.create({ kid: 'T', storage: s3, keyFn: KF, setFn: () => bank[0].cards, fetch: (u, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({ json: () => ({ success: 'true' }) }); } });
  lg.openedSet(); await new Promise(r => setTimeout(r, 0)); assert.strictEqual(sent[0].set, bank[0].id);
  // Service worker never handles POSTs or cross-origin requests.
  const sw = fs.readFileSync(__dirname + '/sw.js', 'utf8');
  assert(/if \(req\.method !== 'GET'\) return;/.test(sw) && /if \(url\.origin !== self\.location\.origin\) return;/.test(sw), 'sw ignores POST / cross-origin');
  const ver = sw.match(/var VERSION = '([^']+)'/)[1], html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  assert(html.includes('sw.js?v=' + ver) && html.includes('manifest.json?v=' + ver), 'index.html ?v= matches sw VERSION');
  console.log('Coda Stars hook tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// Looking up the day's set (words log) must not swallow a completion; an old set already right from earlier sessions completes on next look.
(() => {
  const KF = SRS.key || (w => w.word);
  const mem = () => ({ d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } });
  const list = SRS.setList(words), dated = list.filter(s => /^\d{4}/.test(s.id)), newest = dated[dated.length - 1];
  const st = SRS.loadSets(mem()), pr = {};
  newest.cards.forEach(w => SRS.record(pr, KF(w), true));            // all right, like the app's first-try record
  SRS.daySet(words, st, pr, KF, '2026-10-31'); SRS.resolveCurrent(words, st, pr, KF);
  assert.strictEqual(st.current, newest.id, 'no silent advance');
  const res = SRS.completeIfDone(words, st, pr, KF);
  assert(res && res.from === newest.id && res.to === list[list.indexOf(newest) + 1].id, 'completion reported once');
  assert.strictEqual(SRS.completeIfDone(words, st, pr, KF), null);
  console.log('Completion-reporting tests passed');
})();
