# ⛰️ Summit — adaptive SAT practice

Practice with **real College Board questions** — the same official digital-SAT
question bank behind apps like Dolphin SAT — but served **adaptively**: tell
Summit your current score, and every right or wrong answer tunes what comes
next. Get questions right and they climb toward test-day hard; struggle and
they ease off until you're ready. A live 400–1600 score estimate updates as
you go.

## What it does

- **📝 Adaptive practice** — an Elo-style engine tracks an ability rating per
  section *and* per domain. Each question is picked from the unseen pool near
  your ~70%-success sweet spot (the productive-struggle zone), weighted toward
  your weakest domains. College Board's own difficulty tags (score bands 1–7,
  E/M/H) drive the difficulty model. Nothing repeats until the pool runs out.
- **✅ Official everything** — questions, answers, *and* rationales come from
  College Board's public SAT Suite Question Bank (~3,000 digital-SAT items
  across Reading & Writing and Math, including grid-ins). Summit writes none
  of its own questions.
- **📈 Score prediction** *(premium)* — your rating maps back to a live
  200–800 per section / 400–1600 total estimate, with a trend line after
  every answer.
- **⏱️ Timed mocks** *(premium)* — a real module against the clock (27 R&W
  questions in 32 min, or 22 Math in 35), no feedback until the end, then a
  full review with official explanations. Results feed your rating at half
  weight.
- **📊 Weakness analytics** *(premium)* — accuracy by domain and by skill,
  worst first, so you always know what to drill.
- **🔥 Streaks and a daily rhythm** — free accounts get **10 adaptive
  questions a day** with full explanations; premium removes the cap.

## Setup (2 minutes)

1. Serve the repo (`python3 -m http.server`) and open `/sat/` — or use the
   GitHub Pages URL. On a phone, "Add to Home Screen" installs it like an app.
2. Enter a recent SAT/PSAT score if you have one (it sets your starting
   difficulty — skippable).
3. **Download the question bank** — one tap in the app pulls all ~3,000
   official questions from College Board's public API into your browser
   (resumable if interrupted). Command-line alternative:

   ```bash
   node sat/tools/fetch-bank.mjs        # writes sat/data/bank.json (node 18+)
   ```

   The app loads that file automatically. `--limit 5` for a quick smoke test,
   `--section rw|math` for one section.

Append `?mock=1` to the URL to try the whole app on a small built-in sample
bank — clearly labeled, no network needed.

## Premium & unlock codes

Premium gates unlimited practice, mocks, score prediction, and analytics.
There are **no payments wired up yet** — the upgrade screen redeems unlock
codes so early access can be granted/gifted while the app is pre-revenue.
Mint codes from the repo:

```bash
node -e "console.log(require('./sat/js/premium.js').makeCode('FRIEND1','summit-v1'))"
```

The check is a client-side checksum (`sat/js/premium.js`) — deliberately a
stub. When real money arrives (Stripe on web, App Store/Play billing once
wrapped with Capacitor), replace code redemption with a verified entitlement;
every feature already gates through one `premium.active` flag.

## The legal fine print — read before charging money

Summit is an independent study tool, **not affiliated with or endorsed by
College Board**. The questions are College Board's copyrighted content,
served from their own public question bank. Summit therefore:

- has each user download the bank **from College Board directly** to their
  own device, rather than redistributing it;
- keeps the downloaded `sat/data/bank.json` out of the repo
  (`sat/data/.gitignore`).

Selling access to an app whose content is College Board's carries real
takedown/licensing risk — the same risk every unofficial SAT-prep app
carries. Review College Board's terms (and consider a lawyer) before
attaching real payments.

## Project layout

```
index.html            app shell
manifest.webmanifest  installable-app metadata
css/style.css         styles (light + dark)
js/config.js          qbank endpoints, sections, cap, pricing copy
js/qnorm.js           College Board payload → one schema; grid-in grading (node-testable)
js/adaptive.js        pure engine: ratings, K-decay, selection, mocks, score estimate (node-testable)
js/premium.js         daily cap + unlock-code stub (node-testable)
js/storage.js         localStorage state: profile, seen, streaks, history
js/bank.js            bank loading (file → IndexedDB) + in-app downloader w/ CORS-proxy fallback
js/app.js             screens & wiring
data/sample-bank.json 24 labeled sample questions for ?mock=1
tools/fetch-bank.mjs  command-line bank downloader (resumable)
test/                 node --test sat/test/*.test.js
```
