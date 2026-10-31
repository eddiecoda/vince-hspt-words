# Vince's HSPT Words: synonym & antonym flashcards

Static site (no backend). Files: index.html, style.css, app.js (UI), srs.js (spaced repetition), words.json (cards).
Each card is {word, type: "synonym"|"antonym", choices[4], answer, definition, example, sentence, addedDate}. Progress is keyed by word+type,
so one word can have both a synonym card and an antonym card. Progress lives in localStorage under `vince-hspt-progress-v1` (per device and per site URL).

`sentence` is one 8th-grade context sentence that uses the word's part of speech (the base form in `word`) with the word replaced by `_____` (exactly five underscores). Do not include the word itself. The blank should be guessable from the sentence. Future sets need a sentence on every card. If a card has no usable sentence, the sentence quiz uses `definition` as the clue instead. The format is also documented at the top of sentencequiz.js.

```json
"sentence": "The frozen puddle was so _____ that his shoe cracked straight through the ice."
```

- Test: `node test.js`
- Local preview: `python3 -m http.server 8766` then open http://127.0.0.1:8766/
- Add a set: `python3 add_words.py new_words.json` (validates, skips duplicate word+type, sets addedDate=today, set=next V-0NN, order=next, appends to used_words.txt)
- Publish: `./deploy.sh` (tests, then pushes to github.com/eddiecoda/vince-hspt-words; GitHub Pages serves https://eddiecoda.github.io/vince-hspt-words/)

Modes: Current set, Review missed, Synonyms only, Antonyms only, Mix, plus Stats and Reset.
Word sets: every card has `set` (string id) and `order` (number). The original daily batches use their addedDate as the set id; the bank of
upcoming sets is V-001, V-002, ... "Current set" (stored in localStorage `vince-hspt-sets-v1`) starts at the newest dated batch and moves to the
next unfinished set in order as soon as every card in it has been answered right at least once (any mode, retries count). The app then shows
"Set done! New words unlocked". Later bank sets stay hidden from Mix/Review/Synonyms/Antonyms/Stats until reached. When the bank runs out it stays on
the last set and shows "New words coming soon"; add more sets with add_words.py (each run = the next V-0NN set) and it moves on automatically.

Coda Stars hook: on `opened` (first time a set is opened that ET day) and `completed`, the app POSTs JSON (sent as text/plain to avoid a CORS
preflight) to https://coda-kids-app.vercel.app/api/vocab/event: {kid: 'vince', event, set, next_set, answered, right, date_et}. Fire-and-forget:
errors are swallowed and never block the UI.

Spaced repetition: a miss sends a card to box 0, so it's due again right away and also comes back 3 cards later in the same session.
Each right answer moves it up a box: due again in 1, 2, 4, 8, then 16 days. Right 3 times in a row counts as mastered.

Daily words log (wordlog.js): each device sends one cumulative record per day (ET) to FormSubmit, which emails codafamily@mail.grokbot.com
with subject `WORDS LOG <Kid> <YYYY-MM-DD> auto|button`. Auto records go out when the current set is opened, when every card in it has a first
answer today / a session finishes, and when the page is hidden, only if the numbers changed. The "I did my words today" button sends source=button.
Fields: kid, date_et, time_et, source, set (id of the set worked today, e.g. 2026-10-24 or V-001), set_size, opened_set, answered, right (first try of the day), completed_all, button_tapped_today.

Sentence quiz (sentencequiz.js), 3 times a week: a quiz opens at midnight Eastern Time on each day in `QUIZ_DAYS` (`[1, 3, 5]` = Monday, Wednesday, Friday; `0` = Sunday … `6` = Saturday, at the top of that file) and stays open until Vince finishes it. Its id (`quiz_id`) is the date of the quiz day it belongs to. If an older quiz is still unfinished when the next quiz day arrives, the newer quiz replaces it. When he's done, the home screen says when the next one opens ("The next one opens Wednesday."). It has 10 to 15 items (`QUIZ_MIN` / `QUIZ_MAX`), worst words first, from practice since the previous quiz day (midnight on the previous quiz day up to this quiz day's midnight: Wednesday's quiz covers Mon–Tue, Monday's covers Fri–Sun):
- missed at least once
- several tries (2 or more wrong, or `SEVERAL_TRIES` attempts with at least one miss)
- a slow answer (`SLOW_MS`, 20 seconds; time the card was hidden is not counted)

Flashcard timing is stored under `vince-hspt-attempts-v1`, separate from progress, so existing `vince-hspt-progress-v1` data is left alone. If a card has no timed attempts in the window but its saved progress was updated then, it still counts (a wrong last result counts as a miss). If there are fewer than 10 tough words, other words practiced in the window fill the list, then recent words (his current set, then the previous set, least-known first). He picks from that quiz's word bank or types the word; extra spaces and capital letters are ignored. A miss is recorded like a flashcard miss, so the card comes back in Review, and it also counts toward the next sentence quiz.

When he finishes, the same FormSubmit endpoint emails codafamily@mail.grokbot.com. Subject: `WORDS LOG Vince <YYYY-MM-DD> quiz` (the ET date he finished). Fields: kid, date_et, time_et, source (`quiz`), score (`8/10`), correct, total, missed (comma-separated words, or `none`), week_of (the quiz id: the Mon/Wed/Fri date the quiz opened, `YYYY-MM-DD`; the field name is kept for the existing log). This send does not change the daily auto/button log.

It also fires a Coda Stars POST (text/plain body, JSON) to https://coda-kids-app.vercel.app/api/vocab/event the first time a quiz is finished: `{kid: 'vince', event: 'quiz_completed', quiz_id: 'YYYY-MM-DD', correct, total, date_et}`. Fire-and-forget: every error (network, 400 while the server side deploys, etc.) is swallowed and never blocks the UI. The localhost `#simweek` dry run skips it.

On a local preview only, `#simweek` loads a sample window of misses and does not email. It does nothing on the public site.

Installable PWA: manifest.json (PNG icons 192/512 + maskable 512, scope/start_url = the repo subpath), apple-touch-icon.png (180), and sw.js
(network-first for index.html and words.json; never touches POSTs or cross-origin requests such as formsubmit.co). Bump VERSION in sw.js and the ?v= in index.html when changing cached files (sentencequiz.js is part of the shell).
Icons were rendered from icon.svg with headless Chrome.
