# Vince's HSPT Words: synonym & antonym flashcards

Static site (no backend). Files: index.html, style.css, app.js (UI), srs.js (spaced repetition), words.json (cards).
Each card is {word, type: "synonym"|"antonym", choices[4], answer, definition, example, addedDate}. Progress is keyed by word+type,
so one word can have both a synonym card and an antonym card. Progress lives in localStorage under `vince-hspt-progress-v1` (per device and per site URL).

- Test: `node test.js`
- Local preview: `python3 -m http.server 8766` then open http://127.0.0.1:8766/
- Add cards: `python3 add_words.py new_words.json` (validates, skips duplicate word+type, sets addedDate=today, appends to used_words.txt)
- Publish: `./deploy.sh` (tests, then pushes to github.com/eddiecoda/vince-hspt-words; GitHub Pages serves https://eddiecoda.github.io/vince-hspt-words/)

Modes: Today's set (newest addedDate batch), Review missed, Synonyms only, Antonyms only, Mix, plus Stats and Reset.
Spaced repetition: a miss sends a card to box 0, so it's due again right away and also comes back 3 cards later in the same session.
Each right answer moves it up a box: due again in 1, 2, 4, 8, then 16 days. Right 3 times in a row counts as mastered.
