/* Shared test scaffolding: a config tuned for fast deterministic tests and a
 * throwaway on-disk store. */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CONFIG } = require('../js/config.js');
const { createStore } = require('../js/store.js');

/* Deep-clone the real config, then apply per-section overrides. */
function makeCfg(over) {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  for (const k of Object.keys(over || {})) Object.assign(cfg[k], over[k]);
  return cfg;
}

/* Fast-warmup config for pipeline tests: tiny vol warmup, no cooldown, short
 * latency, permissive books. */
function testCfg(over) {
  return makeCfg(Object.assign({
    SPOT: { minVolSamples: 5, sampleMs: 1000, volHalfLifeMs: 60e3, staleMsgMs: 60e3 },
    STRATEGY: { minEdge: 0.05, minTauSec: 5, maxTauSec: 24 * 3600, exitFlipEdge: 0.05, cooldownMs: 0 },
    TRADE: { sizeUsd: 10, paperLatencyMs: 1000 },
    BOOKS: { pollMs: 2500, staleMs: 60e3, minDepthContracts: 5 },
    ENGINE: { tickMs: 1000 },
  }, over || {}));
}

function tempStore() {
  return createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'fairline-test-')) });
}

/* A canonical YES-side book: single level each side. */
function book(t, bid, ask, size) {
  const s = size || 100;
  return { t, bids: [{ p: bid, s }], asks: [{ p: ask, s }] };
}

/* An 'above' market resolving at closeTime. */
function aboveMarket(over) {
  return Object.assign({
    platform: 'polymarket', id: 'm1', key: 'polymarket:m1', asset: 'BTC',
    kind: 'above', floor: 100, cap: null, closeTime: 60e3, windowStart: null,
    title: 'test market', url: 'https://example.invalid/m1',
    tokenIds: ['1', '2'], yesLabel: 'Yes',
  }, over || {});
}

module.exports = { makeCfg, testCfg, tempStore, book, aboveMarket };
