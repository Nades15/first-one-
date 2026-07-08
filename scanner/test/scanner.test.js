/* Scout scan engine tests — run with: node --test scanner/test/ */
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizePolymarket, normalizeKalshi, findCandidates } = require('../js/scanner.js');

const NOW = Date.UTC(2026, 6, 8, 12, 0, 0);
const hrs = h => new Date(NOW + h * 3600e3).toISOString();

/* ------------------------- Polymarket normalize ------------------------- */

const POLY_RAW = [
  { id: '501', question: 'Will the Fed cut rates in September?',
    outcomes: '["Yes","No"]', outcomePrices: '["0.76","0.24"]',
    volume24hr: 184000, liquidityNum: 420000, endDate: hrs(24 * 5),
    slug: 'fed-cut', category: 'Economics', events: [{ slug: 'fed-september' }] },
  { id: '502', question: 'Broken market', outcomes: '["Yes","No"]',
    outcomePrices: '["0.5"]', volume24hr: 100, endDate: hrs(24) },       // mismatched lengths
  { id: '503', question: 'Team A vs Team B',
    outcomes: ['Team A', 'Team B'], outcomePrices: ['0.72', '0.28'],     // already-parsed arrays
    volume24hr: '5000', liquidityNum: 9000, endDate: hrs(48), slug: 'a-vs-b' },
];

test('normalizePolymarket parses string-encoded outcome arrays', () => {
  const [m] = normalizePolymarket([POLY_RAW[0]]);
  assert.equal(m.platform, 'polymarket');
  assert.equal(m.title, 'Will the Fed cut rates in September?');
  assert.deepEqual(m.outcomes, [{ label: 'Yes', prob: 0.76 }, { label: 'No', prob: 0.24 }]);
  assert.equal(m.volume24h, 184000);
  assert.equal(m.url, 'https://polymarket.com/event/fed-september');
  assert.equal(m.closeTime, NOW + 5 * 24 * 3600e3);
  assert.equal(m.category, 'Economics');
});

test('normalizePolymarket skips malformed markets, tolerates plain arrays and string numbers', () => {
  const out = normalizePolymarket(POLY_RAW);
  assert.equal(out.length, 2);                          // '502' dropped
  const b = out.find(m => m.id === '503');
  assert.equal(b.volume24h, 5000);
  assert.deepEqual(b.outcomes.map(o => o.label), ['Team A', 'Team B']);
  assert.equal(b.url, 'https://polymarket.com/market/a-vs-b');  // no event slug → market slug
});

/* --------------------------- Kalshi normalize --------------------------- */

const KALSHI_RAW = [
  { ticker: 'KXHIGHNY-26JUL12-B85', event_ticker: 'KXHIGHNY-26JUL12',
    title: 'Highest temperature in NYC', yes_sub_title: '85° or above',
    yes_bid: 74, yes_ask: 78, last_price: 75, volume_24h: 21000,
    open_interest: 65000, close_time: hrs(24 * 4), category: 'Climate' },
  { ticker: 'KXCPI-26JUL-T3', event_ticker: 'KXCPI-26JUL', title: 'CPI above 3%',
    yes_bid: 0, yes_ask: 0, last_price: 24, volume_24h: 500, close_time: hrs(24) },   // last-price fallback
  { ticker: 'KXDEAD-26', event_ticker: 'KXDEAD-26', title: 'Dead book',
    yes_bid: 0, yes_ask: 0, last_price: 0, volume_24h: 0, close_time: hrs(24) },      // no quote at all
];

test('normalizeKalshi quotes the bid/ask midpoint and emits both sides', () => {
  const [m] = normalizeKalshi([KALSHI_RAW[0]]);
  assert.equal(m.platform, 'kalshi');
  assert.equal(m.title, 'Highest temperature in NYC — 85° or above');
  assert.equal(m.outcomes[0].label, 'YES');
  assert.ok(Math.abs(m.outcomes[0].prob - 0.76) < 1e-9);          // (74+78)/2 ¢
  assert.equal(m.outcomes[1].label, 'NO');
  assert.ok(Math.abs(m.outcomes[1].prob - 0.24) < 1e-9);
  assert.equal(m.url, 'https://kalshi.com/markets/kxhighny');     // series from event ticker
});

test('normalizeKalshi falls back to last price and drops dead books', () => {
  const out = normalizeKalshi(KALSHI_RAW);
  assert.equal(out.length, 2);                                    // dead book dropped
  const cpi = out.find(m => m.id === 'KXCPI-26JUL-T3');
  assert.ok(Math.abs(cpi.outcomes[0].prob - 0.24) < 1e-9);
});

/* ----------------------------- findCandidates ---------------------------- */

function market(over) {
  return Object.assign({
    platform: 'kalshi', id: 'M', title: 'Test market', category: '',
    outcomes: [{ label: 'YES', prob: 0.75 }, { label: 'NO', prob: 0.25 }],
    volume24h: 10000, liquidity: 1000, closeTime: NOW + 48 * 3600e3, url: '#',
  }, over);
}

const OPTS = { bandLo: 70, bandHi: 80, minVolume24h: 1000, resolveWithinHours: 168, maxResults: 30, now: NOW };

test('band filter finds the NO side of a low-priced market', () => {
  const out = findCandidates([market({
    outcomes: [{ label: 'YES', prob: 0.25 }, { label: 'NO', prob: 0.75 }],
  })], OPTS);
  assert.equal(out.length, 1);
  assert.equal(out[0].side, 'NO');
  assert.equal(out[0].prob, 0.75);
});

test('band filter excludes out-of-band markets and picks one side per market', () => {
  assert.equal(findCandidates([market({
    outcomes: [{ label: 'YES', prob: 0.55 }, { label: 'NO', prob: 0.45 }],
  })], OPTS).length, 0);
  // Wide band with both sides inside → only the side nearest the center is kept.
  const wide = findCandidates([market({
    outcomes: [{ label: 'YES', prob: 0.52 }, { label: 'NO', prob: 0.48 }],
  })], Object.assign({}, OPTS, { bandLo: 40, bandHi: 60 }));
  assert.equal(wide.length, 1);
  assert.equal(wide[0].side, 'YES');
});

test('volume, resolution-window, and keyword filters apply', () => {
  assert.equal(findCandidates([market({ volume24h: 500 })], OPTS).length, 0);
  assert.equal(findCandidates([market({ closeTime: NOW + 200 * 3600e3 })], OPTS).length, 0);
  assert.equal(findCandidates([market({ closeTime: null })], OPTS).length, 0);       // unknown close vs window
  assert.equal(findCandidates([market({ closeTime: NOW - 1000 })], OPTS).length, 0); // already closed
  assert.equal(findCandidates([market({ closeTime: null })],
    Object.assign({}, OPTS, { resolveWithinHours: 0 })).length, 1);                  // "any" window
  const kw = Object.assign({}, OPTS, { keyword: 'fed' });
  assert.equal(findCandidates([market({ title: 'Will the Fed cut?' })], kw).length, 1);
  assert.equal(findCandidates([market({ title: 'NBA finals' })], kw).length, 0);
});

test('ranking prefers band center and volume; maxResults caps the list', () => {
  const centered = market({ id: 'A', volume24h: 10000 });
  const edge = market({ id: 'B', outcomes: [{ label: 'YES', prob: 0.795 }, { label: 'NO', prob: 0.205 }], volume24h: 10000 });
  const thin = market({ id: 'C', volume24h: 1200 });
  const out = findCandidates([edge, thin, centered], OPTS);
  assert.deepEqual(out.map(c => c.id), ['A', 'C', 'B']);
  assert.equal(findCandidates([edge, thin, centered], Object.assign({}, OPTS, { maxResults: 2 })).length, 2);
});
