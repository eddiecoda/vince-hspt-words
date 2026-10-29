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

// Weekly sentence quiz
const SQ = require('./sentencequiz.js');
assert.strictEqual(SQ.QUIZ_WEEKDAY, 0, 'Sunday is the default; change QUIZ_WEEKDAY and these comments together');
assert.strictEqual(SQ.DAY_NAME, 'Sunday');
assert.ok(SQ.QUIZ_MIN >= 10 && SQ.QUIZ_MAX <= 15 && SQ.QUIZ_MIN <= SQ.QUIZ_MAX);
words.forEach(w => assert.strictEqual(SQ.key(w), K(w), 'quiz keys match SRS ' + w.word));

// Unlock day follows QUIZ_WEEKDAY in Eastern Time, and the window is the 7 days before it.
const thu = Date.parse('2026-10-29T15:00:00Z'); // Thu Oct 29, 2026, 11:00 ET
assert.strictEqual(SQ.unlockId(thu), '2026-10-25');
assert.strictEqual(SQ.etParts(new Date(SQ.etMidnight('2026-10-25'))).weekday, 'Sun');
assert.strictEqual(SQ.unlockId(SQ.etMidnight('2026-10-25') - 1000), '2026-10-18', 'just before Sunday is the previous quiz');
assert.strictEqual(SQ.unlockId(SQ.etMidnight('2026-10-25') + 30 * 60 * 1000), '2026-10-25');
const win = SQ.weekWindow('2026-10-25');
assert.strictEqual(win.start, SQ.etMidnight('2026-10-18'));
assert.strictEqual(win.end, SQ.etMidnight('2026-10-25'));
// DST ends Nov 1, 2026; midnight Eastern is still a real instant.
assert.strictEqual(SQ.etParts(new Date(SQ.etMidnight('2026-11-01'))).hour, '00');
assert.strictEqual(SQ.unlockId(Date.parse('2026-11-01T03:30:00Z')), '2026-10-25', 'Saturday night before the DST change');
assert.strictEqual(SQ.unlockId(Date.parse('2026-11-01T06:30:00Z')), '2026-11-01');

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
const builtBare = SQ.buildQuiz([bare], [{ t: win.start + 1000, key: 'ZEST:synonym', ok: false, ms: 1000 }], '2026-10-25');
assert.strictEqual(builtBare.items[0].fallback, true);
assert.strictEqual(builtBare.items[0].clue, 'lively energy');

// Simulated week: misses, several tries, and a slow answer, then top-up from the other words.
const demoStore = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const before = JSON.stringify(SRS.load(demoStore));
const demoAttempts = SQ.demoWeekAttempts(words, thu);
demoAttempts.forEach(a => SQ.recordAttempt(demoStore, a, thu));
assert.strictEqual(JSON.stringify(SRS.load(demoStore)), before, 'attempt log does not touch SRS progress');
assert.notStrictEqual(SQ.ATTEMPT_KEY, SRS.STORE_KEY);
assert.strictEqual(SQ.loadAttempts(demoStore).length, demoAttempts.length);
// Just outside the week must not change this quiz. (The earlier one belongs to the previous week.)
const demo = SQ.buildQuiz(words, SQ.loadAttempts(demoStore).concat([
  { t: win.start - 1, key: K(words[0]), ok: false, ms: 1000 },
  { t: win.end, key: K(words[1]), ok: false, ms: 1000 }
]), '2026-10-25');
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
assert.strictEqual(SQ.buildQuiz(words, many, '2026-10-25').items.length, 15);
const fewTough = [attempt('TEDIOUS', false, 1000, win.start + 5000), attempt('ADEQUATE', true, 1000, win.start + 6000),
  attempt('BRITTLE', true, 1000, win.start + 7000), attempt('DISMAL', true, 1000, win.start + 8000)];
assert.strictEqual(SQ.buildQuiz(words, fewTough, '2026-10-25').items[0].word, 'TEDIOUS');
assert.strictEqual(SQ.buildQuiz(words, fewTough, '2026-10-25').items.length, 4);
const topped = fewTough.concat(words.slice(2, 12).map(w => attempt(w.word, true, 1000, win.start + 9000)));
const toppedQuiz = SQ.buildQuiz(words, topped, '2026-10-25');
assert.strictEqual(toppedQuiz.items.length, 10);
assert.strictEqual(toppedQuiz.items[0].word, 'TEDIOUS');
assert.strictEqual(toppedQuiz.toughCount, 1);
assert.strictEqual(SQ.buildQuiz(words, [attempt('HOSTILE', true, SQ.SLOW_MS, win.start + 5000)], '2026-10-25').items[0].tough, true);
assert.strictEqual(SQ.buildQuiz(words, [attempt('HOSTILE', true, SQ.SLOW_MS - 1, win.start + 5000)], '2026-10-25').items[0].tough, false);
// Three correct showings are not "several tries". Three attempts with a miss are.
const calm = [1, 1, 1].map((ok, i) => attempt('PLACID', true, 1000, win.start + 1000 * (i + 1)));
assert.strictEqual(SQ.buildQuiz(words, calm, '2026-10-25').items[0].tough, false);
const several = [attempt('PLACID', false, 1000, win.start + 1000), attempt('PLACID', false, 1000, win.start + 2000), attempt('PLACID', true, 1000, win.start + 3000)];
assert.strictEqual(SQ.buildQuiz(words, several, '2026-10-25').items[0].tough, true);

// Backfill from existing progress when that card was touched during the week but has no timed attempts.
const backProgress = {};
SRS.record(backProgress, K(words.find(w => w.word === 'RIGID')), false, win.start + 8000);
SRS.record(backProgress, K(words.find(w => w.word === 'PLACID')), true, win.start + 9000);
SRS.record(backProgress, K(words.find(w => w.word === 'ZEALOUS')), false, win.start - 10);
const back = SQ.buildQuiz(words, [], '2026-10-25', backProgress);
assert.deepStrictEqual(back.items.map(i => i.word), ['RIGID', 'PLACID']);
assert.strictEqual(back.items[0].tough, true);
assert.strictEqual(back.items[1].tough, false);
// A timed attempt wins over the saved last result so a later correct answer does not hide an earlier miss.
const mixed = SQ.buildQuiz(words, [attempt('RIGID', false, 1000, win.start + 1000), attempt('RIGID', true, 1000, win.start + 2000)], '2026-10-25', backProgress);
assert.strictEqual(mixed.items[0].tough, true);

// Available on the unlock day until finished; the previous week stays open if it was never finished.
const emptyState = { byWeek: {} };
const ready = SQ.selectQuiz(words, SQ.loadAttempts(demoStore), emptyState, thu);
assert.strictEqual(ready.phase, 'ready');
assert.strictEqual(ready.id, '2026-10-25');
assert.strictEqual(ready.items ? ready.built.items.length : ready.built.items.length, 10);
const doneState = { byWeek: { '2026-10-25': { correct: 8, total: 10, missed: ['TEDIOUS'], emailed: true } } };
assert.strictEqual(SQ.selectQuiz(words, SQ.loadAttempts(demoStore), doneState, thu).phase, 'done');
assert.strictEqual(SQ.selectQuiz(words, [], emptyState, thu).phase, 'empty');
// Previous week still waiting, even after the next unlock morning.
const prevAttempts = [attempt('LAX', false, 1000, SQ.etMidnight('2026-10-18') - 5000)];
const overdue = SQ.selectQuiz(words, prevAttempts, emptyState, SQ.etMidnight('2026-10-25') + 60 * 1000);
assert.strictEqual(overdue.phase, 'ready');
assert.strictEqual(overdue.id, '2026-10-18');
assert.strictEqual(overdue.overdue, true);
const afterPrev = SQ.selectQuiz(words, prevAttempts, { byWeek: { '2026-10-18': { correct: 0, total: 1, missed: ['LAX'] } } }, SQ.etMidnight('2026-10-25') + 60 * 1000);
assert.strictEqual(afterPrev.phase, 'done', 'finished last week stays done until the new week has words');
assert.strictEqual(afterPrev.id, '2026-10-18');
assert.strictEqual(afterPrev.result.missed[0], 'LAX');

// Quiz miss feeds review weighting, and completion is stored once.
const quizMem = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const qp = {};
const tedious = words.find(w => w.word === 'TEDIOUS');
const marked = SQ.markComplete(quizMem, '2026-10-25', { correct: 0, total: 1, missed: ['TEDIOUS'], missedKeys: [K(tedious)], at: thu });
assert.strictEqual(marked.fresh, true);
SRS.record(qp, K(tedious), false, thu);
assert.strictEqual(qp[K(tedious)].lastResult, 'wrong');
assert.deepStrictEqual(SRS.reviewWords([tedious], qp, thu).map(K), [K(tedious)]);
assert.strictEqual(SQ.markComplete(quizMem, '2026-10-25', { correct: 1, total: 1, missed: [] }).fresh, false, 'finishing twice does not reset the score');
SQ.setEmailed(quizMem, '2026-10-25', true);
assert.strictEqual(SQ.loadState(quizMem).byWeek['2026-10-25'].emailed, true);
console.log('Sentence quiz tests passed');

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
