/* Strategy decisions — node --test fairline/test/strategy.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluate, resolveYes, feePerContract } = require('../js/strategy.js');
const { testCfg, book, aboveMarket } = require('./helpers.js');

function dcfg(over) {
  const cfg = testCfg(over);
  return { strategy: cfg.STRATEGY, books: cfg.BOOKS, fees: cfg.FEES, sizeUsd: cfg.TRADE.sizeUsd };
}

const base = () => ({ market: aboveMarket({ closeTime: 600e3 }), book: book(1000, 0.50, 0.55),
  fair: null, position: null, t: 1000, lastFillT: 0, cfg: dcfg() });

test('buys YES when fair clears the ask by minEdge', () => {
  const d = evaluate(Object.assign(base(), { fair: 0.62 }));
  assert.equal(d.action, 'buy_yes');
  assert.equal(d.price, 0.55);
  assert.equal(d.contracts, Math.floor(10 / 0.55));
  assert.ok(Math.abs(d.edge - 0.07) < 1e-9);
});

test('buys NO when fair sits far below the NO ask complement', () => {
  const d = evaluate(Object.assign(base(), { fair: 0.40 }));
  assert.equal(d.action, 'buy_no');       // noAsk = 1 − yesBid = 0.50; edge = 0.60 − 0.50 = 0.10
  assert.equal(d.price, 0.5);
  assert.equal(d.contracts, 20);
});

test('kalshi fee eats into the edge', () => {
  const m = aboveMarket({ platform: 'kalshi', closeTime: 600e3 });
  // fee at ask 0.55 ≈ 0.0173 ⇒ net edge 0.0527: enters at minEdge 0.05…
  assert.equal(evaluate(Object.assign(base(), { market: m, fair: 0.62 })).action, 'buy_yes');
  // …but not at minEdge 0.06
  const strict = dcfg({ STRATEGY: { minEdge: 0.06 } });
  const d = evaluate(Object.assign(base(), { market: m, fair: 0.62, cfg: strict }));
  assert.equal(d.action, null);
  assert.equal(d.reason, 'NO_EDGE');
  assert.ok(Math.abs(feePerContract('kalshi', 0.55, strict.fees) - 0.07 * 0.55 * 0.45) < 1e-12);
});

test('guards: no fair, stale book, tau window, cooldown, thin book, tiny size', () => {
  assert.equal(evaluate(Object.assign(base(), { fair: null })).reason, 'UNPRICEABLE');
  assert.equal(evaluate(Object.assign(base(), { fair: 0.62, book: null })).reason, 'NO_BOOK');
  assert.equal(evaluate(Object.assign(base(), { fair: 0.62, t: 1000 + 61e3,
    book: book(0, 0.5, 0.55), market: aboveMarket({ closeTime: 600e3 }) })).reason, 'STALE_BOOK');
  assert.equal(evaluate(Object.assign(base(), { fair: 0.62,
    market: aboveMarket({ closeTime: 1000 + 4000 }) })).reason, 'TOO_CLOSE');
  assert.equal(evaluate(Object.assign(base(), { fair: 0.62,
    market: aboveMarket({ closeTime: 1000 + 48 * 3600e3 }) })).reason, 'TOO_FAR');
  const cool = dcfg({ STRATEGY: { cooldownMs: 60e3 } });
  assert.equal(evaluate(Object.assign(base(), { fair: 0.62, lastFillT: 500, cfg: cool })).reason, 'COOLDOWN');
  assert.equal(evaluate(Object.assign(base(), { fair: 0.62, book: book(1000, 0.5, 0.55, 2) })).reason, 'THIN_BOOK');
});

test('holding: exits only when the book over-prices our side by exitFlipEdge', () => {
  const posYes = { side: 'yes', avgPrice: 0.55, contracts: 18 };
  // bid 0.50 vs fair 0.40 → bid − fair = 0.10 ≥ 0.05 ⇒ take it
  const d = evaluate(Object.assign(base(), { fair: 0.40, position: posYes }));
  assert.equal(d.action, 'exit');
  assert.equal(d.side, 'yes');
  assert.equal(d.price, 0.5);
  // bid 0.50 vs fair 0.48 → 0.02 < 0.05 ⇒ hold to resolution
  assert.equal(evaluate(Object.assign(base(), { fair: 0.48, position: posYes })).reason, 'HOLDING');
  // NO position: noBid = 1 − ask = 0.45; fair 0.62 ⇒ noBid − (1−fair) = 0.07 ⇒ exit
  const posNo = { side: 'no', avgPrice: 0.5, contracts: 20 };
  const dn = evaluate(Object.assign(base(), { fair: 0.62, position: posNo }));
  assert.equal(dn.action, 'exit');
  assert.equal(dn.side, 'no');
});

test('resolveYes reduces every kind to floor < spot ≤ cap', () => {
  assert.equal(resolveYes({ floor: 100, cap: null }, 100.01), true);    // above
  assert.equal(resolveYes({ floor: 100, cap: null }, 100), false);      // ties lose "above"
  assert.equal(resolveYes({ floor: null, cap: 150 }, 149), true);       // below
  assert.equal(resolveYes({ floor: 3550, cap: 3650 }, 3600), true);     // range
  assert.equal(resolveYes({ floor: 3550, cap: 3650 }, 3700), false);
  assert.equal(resolveYes({ floor: null, cap: null }, 100), null);      // never priced
  assert.equal(resolveYes({ floor: 100, cap: null }, null), null);      // no spot at close
});
