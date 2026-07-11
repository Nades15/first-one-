> This repo hosts four small web apps:
> **🧠 Lumen** (below), **📈 [MFFU Trade Copilot](tradebot/README.md)** — an AI
> chart-analysis assistant + rules guardian for MyFundedFutures 25k evaluations,
> living in [`tradebot/`](tradebot/) — **🎯 [Scout](scanner/README.md)** — an
> on-demand Polymarket/Kalshi scanner that finds bets priced around 75% to hit,
> with an optional AI second opinion, living in [`scanner/`](scanner/) — and
> **⚡ [Pulse](scalper/README.md)** — a paper-trading memecoin scalper whose
> adaptive smart-exit engine (momentum, volume, liquidity, emergency triggers)
> races a fixed hold timer on seeded synthetic markets, living in
> [`scalper/`](scalper/).

# 🧠 Lumen — daily mind training

Lumen is a lightweight web app for measuring and training your mind. Set an IQ
baseline, then check in for **10–15 minutes a day**. At the end of each week your
score recalibrates based on how you actually performed — consistency counts as
much as brilliance.

## Features

- **Baseline** — take a ~10-minute assessment (20 reasoning questions + 5
  emotional-awareness situations), or manually import a score you already know.
- **Daily circuit** — three rotating brain games with adaptive difficulty:
  - 🧩 *Pattern Matrix* — Raven-style visual pattern completion
  - 🔢 *Number Flow* — spot the rule, predict the next number
  - ⚖️ *Logic Court* — does the conclusion actually follow?
  - 📸 *Photo Memory* — flash-memorise tiles on a grid
  - 🎧 *Digit Echo* — hold a growing digit string in mind (reversed at higher levels)
  - 🌉 *Word Bridges* — verbal analogies
  - 🕵️ *Odd One Out* — categorical reasoning
  - ⚡ *Math Sprint* — 45 seconds of rapid mental arithmetic
- **EQ Moment** — a daily real-life situation ("what would you do?") with
  explained answers, plus an emotion-reading exercise. Your EQ index is tracked
  alongside IQ.
- **Journal** — one reflective prompt a day. Lumen analyses your entry locally
  for vocabulary richness, reflective/insight markers, sentence variety,
  emotional granularity, and perspective-taking — and feeds it into both scores.
- **Weekly recalibration** — every Monday your IQ and EQ indexes shift by a
  bounded amount (−4 to +5) based on the week's performance, scaled by how many
  days you showed up. A recap shows your strongest and weakest domains.
- **Adaptive difficulty** — each domain (logic, memory, verbal, speed) levels up
  when you're strong and eases off when you struggle.
- **Streaks, trend chart, celebration** — designed to be a pleasant daily
  check-in, not a chore.

## Running it

No build step, no dependencies. Either:

- open `index.html` directly in a browser, or
- serve the folder: `npx serve .` (or `python3 -m http.server`) and open the URL.

All data stays in your browser (`localStorage`). Nothing is sent anywhere.

## A note on the score

Lumen's IQ/EQ numbers are **training indexes** — a consistent personal yardstick
for tracking your own week-over-week change. They are not a clinical or
psychometrically normed IQ measurement.

## Project layout

```
index.html        app shell
css/style.css     styles (light + dark mode)
js/data.js        question banks, EQ scenarios, prompts, word lists
js/storage.js     localStorage state + date helpers
js/scoring.js     baseline grading, adaptive difficulty, weekly recalibration
js/journal.js     journal text analysis
js/games.js       the eight brain games + daily circuit rotation
js/app.js         screens, dashboard, EQ moment, journal UI, trend chart
```
