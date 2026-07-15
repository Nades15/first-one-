/* Market discovery normalizers — node --test fairline/test/markets.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectAsset, parseWindowMs, normalizePolymarket, normalizeKalshi, selectWatchlist } = require('../js/markets.js');
const { CONFIG } = require('../js/config.js');

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);
const iso = ms => new Date(ms).toISOString();
const DCFG = CONFIG.DISCOVERY;

test('detectAsset needs word boundaries', () => {
  assert.equal(detectAsset('Will Bitcoin be above $118,000?'), 'BTC');
  assert.equal(detectAsset('ETH up or down'), 'ETH');
  assert.equal(detectAsset('Solana below $150'), 'SOL');
  assert.equal(detectAsset('Console wars: who wins?'), null);   // "sol" inside a word
  assert.equal(detectAsset('Fed decision in September'), null);
});

test('polymarket: above/below strikes parse from the question', () => {
  const raws = [
    { id: '1', question: 'Will Bitcoin be above $118,000 at 5 PM ET?', slug: 'btc-above',
      endDate: iso(NOW + 3600e3), outcomes: '["Yes","No"]', clobTokenIds: '["111","222"]' },
    { id: '2', question: 'Will Solana be below $150.50 at 9 AM ET?', slug: 'sol-below',
      endDate: iso(NOW + 7200e3), outcomes: '["Yes","No"]', clobTokenIds: '["333","444"]' },
  ];
  const out = normalizePolymarket(raws, NOW, DCFG);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].kind, out[0].floor, out[0].cap, out[0].asset], ['above', 118000, null, 'BTC']);
  assert.deepEqual([out[1].kind, out[1].floor, out[1].cap, out[1].asset], ['below', null, 150.5, 'SOL']);
  assert.deepEqual(out[0].tokenIds, ['111', '222']);
});

test('polymarket: up-or-down gets a windowStart and no strike yet', () => {
  const raws = [{ id: '3', question: 'Ethereum Up or Down — July 14, 1PM ET',
    slug: 'ethereum-up-or-down-july-14-1pm-et', endDate: iso(NOW + 3600e3),
    outcomes: '["Up","Down"]', clobTokenIds: '["555","666"]' }];
  const out = normalizePolymarket(raws, NOW, DCFG);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'updown');
  assert.equal(out[0].floor, null);
  assert.equal(out[0].windowStart, NOW + 3600e3 - DCFG.updownWindowMs);
  assert.equal(out[0].yesLabel, 'Up');
});

test('up-or-down window length parses from the real title formats', () => {
  // real 5m / 15m titles observed live on 2026-07-15
  assert.equal(parseWindowMs('Bitcoin Up or Down - July 15, 3:35PM-3:40PM ET'), 5 * 60e3);
  assert.equal(parseWindowMs('Solana Up or Down - July 15, 3:30PM-3:45PM ET'), 15 * 60e3);
  assert.equal(parseWindowMs('Ethereum Up or Down - July 15, 3PM-4PM ET'), 3600e3);
  assert.equal(parseWindowMs('noon wrap 11:55AM-12:00PM ET'), 5 * 60e3);
  assert.equal(parseWindowMs('midnight wrap 11:55PM-12:00AM ET'), 5 * 60e3);
  assert.equal(parseWindowMs('Bitcoin Up or Down - July 15, 3PM ET'), null);   // single time — no range
  assert.equal(parseWindowMs(''), null);

  const raws = [
    { id: '10', question: 'Bitcoin Up or Down - July 15, 3:35PM-3:40PM ET',
      slug: 'bitcoin-up-or-down-july-15-335pm-et', endDate: iso(NOW + 5 * 60e3),
      outcomes: '["Up","Down"]', clobTokenIds: '["777","888"]' },
    { id: '11', question: 'Ethereum Up or Down - July 15, 12PM ET',            // old hourly style
      slug: 'ethereum-up-or-down', endDate: iso(NOW + 3600e3),
      outcomes: '["Up","Down"]', clobTokenIds: '["999","000"]' },
  ];
  const out = normalizePolymarket(raws, NOW, DCFG);
  assert.equal(out[0].windowStart, NOW);                                       // close − 5m
  assert.equal(out[1].windowStart, NOW + 3600e3 - DCFG.updownWindowMs);        // fallback: hourly
});

test('polymarket: barrier wordings and junk are excluded', () => {
  const raws = [
    { id: '4', question: 'Will Ethereum reach $5,000 by July 31?', slug: 'x',
      endDate: iso(NOW + 3600e3), outcomes: '["Yes","No"]', clobTokenIds: '["1","2"]' },   // barrier
    { id: '5', question: 'Will Bitcoin be above $118,000 at 5 PM?', slug: 'x',
      endDate: iso(NOW + 3600e3), outcomes: '["Yes","No"]' },                              // no tokenIds
    { id: '6', question: 'Will the Fed cut rates?', slug: 'x',
      endDate: iso(NOW + 3600e3), outcomes: '["Yes","No"]', clobTokenIds: '["1","2"]' },   // not crypto
    { id: '7', question: 'Will Bitcoin be above $118,000 at 5 PM?', slug: 'x',
      endDate: iso(NOW - 60e3), outcomes: '["Yes","No"]', clobTokenIds: '["1","2"]' },     // already closed
  ];
  assert.equal(normalizePolymarket(raws, NOW, DCFG).length, 0);
});

test('kalshi: structured strikes map to above/below/range', () => {
  const raws = [
    { ticker: 'KXBTCD-26JUL1417-T118249.99', event_ticker: 'KXBTCD-26JUL1417',
      title: 'Bitcoin price at 5pm EDT?', yes_sub_title: '$118,250 or above',
      close_time: iso(NOW + 3600e3), strike_type: 'greater', floor_strike: 118249.99 },
    { ticker: 'KXETHD-26JUL1417-B3600', event_ticker: 'KXETHD-26JUL1417',
      title: 'Ethereum price at 5pm EDT?', yes_sub_title: '$3,550 to $3,650',
      close_time: iso(NOW + 3600e3), strike_type: 'between', floor_strike: 3550, cap_strike: 3650 },
    { ticker: 'KXBTCD-26JUL1417-L110000', event_ticker: 'KXBTCD-26JUL1417',
      title: 'Bitcoin price at 5pm EDT?', close_time: iso(NOW + 3600e3),
      strike_type: 'less', cap_strike: 110000 },
    { ticker: 'KXBTCD-26JUL1417-XX', event_ticker: 'KXBTCD-26JUL1417',
      title: 'Bitcoin price at 5pm EDT?', close_time: iso(NOW + 3600e3),
      strike_type: 'custom' },                                             // unknown type → skip
    { ticker: 'KXHIGHNY-26JUL14-B85', event_ticker: 'KXHIGHNY-26JUL14',
      title: 'Highest temperature in NYC', close_time: iso(NOW + 3600e3),
      strike_type: 'greater', floor_strike: 85 },                          // not crypto → skip
  ];
  const out = normalizeKalshi(raws, NOW);
  assert.equal(out.length, 3);
  assert.deepEqual([out[0].kind, out[0].floor, out[0].cap, out[0].asset], ['above', 118249.99, null, 'BTC']);
  assert.deepEqual([out[1].kind, out[1].floor, out[1].cap, out[1].asset], ['range', 3550, 3650, 'ETH']);
  assert.deepEqual([out[2].kind, out[2].floor, out[2].cap], ['below', null, 110000]);
});

test('selectWatchlist: horizon, asset filter, sort, cap, dedupe', () => {
  const m = (key, closeMs, asset) => ({ key, closeTime: closeMs, asset: asset || 'BTC' });
  const cfg = { horizonMs: 4 * 3600e3, maxMarkets: 3 };
  const list = [
    m('a', NOW + 3 * 3600e3), m('b', NOW + 3600e3), m('c', NOW + 10 * 3600e3),  // c beyond horizon
    m('d', NOW + 1800e3, 'DOGE'),                                               // no spot feed
    m('b', NOW + 3600e3),                                                       // duplicate
    m('e', NOW + 900e3), m('f', NOW + 2 * 3600e3),
  ];
  const out = selectWatchlist(list, NOW, cfg, ['BTC', 'ETH', 'SOL']);
  assert.deepEqual(out.map(x => x.key), ['e', 'b', 'f']);   // soonest first, capped at 3
});
