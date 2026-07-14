/* Fairline — live spot feed. Streams trades for the configured assets from
 * Coinbase Exchange (primary) or Binance (fallback), normalizes them to
 * { asset, price }, and hands them to the pipeline. Pure normalizers are
 * separated from the ws source (Livebot feed.js pattern); WebSocketImpl is
 * injectable so tests run without a network.
 *
 * Failover: a socket that keeps dying or going quiet rotates to the other
 * venue after every ROTATE_AFTER consecutive failures. Prices from the two
 * venues differ slightly, so the vol estimator is reset on venue change by
 * the pipeline (a cross-venue jump is not a real return). */
'use strict';

const ROTATE_AFTER = 3;

/* ----------------------------- normalizers ----------------------------- */

/* Coinbase `matches` channel: { type:'match'|'last_match', product_id, price } */
function normalizeCoinbase(raw, productToAsset) {
  if (!raw || (raw.type !== 'match' && raw.type !== 'last_match')) return null;
  const asset = productToAsset[raw.product_id];
  const price = Number(raw.price);
  if (!asset || !(price > 0)) return null;
  return { asset, price };
}

/* Binance combined stream: { stream:'btcusdt@trade', data:{ e:'trade', p } } */
function normalizeBinance(raw, symbolToAsset) {
  if (!raw || !raw.data || raw.data.e !== 'trade') return null;
  const asset = symbolToAsset[String(raw.stream || '').replace('@trade', '')];
  const price = Number(raw.data.p);
  if (!asset || !(price > 0)) return null;
  return { asset, price };
}

/* ------------------------------ ws source ------------------------------ */

function createSpotSource(opts) {
  const cfg = opts.cfg;                        // CONFIG.SPOT
  const WS = opts.WebSocketImpl || require('ws');
  const onPrice = opts.onPrice || (() => {});  // (asset, price, recvT)
  const onStatus = opts.onStatus || (() => {});

  const productToAsset = {}, symbolToAsset = {};
  for (const [asset, ids] of Object.entries(cfg.assets)) {
    productToAsset[ids.coinbase] = asset;
    symbolToAsset[ids.binance] = asset;
  }

  const VENUES = {
    coinbase: {
      url: () => cfg.coinbaseUrl,
      hello: ws => ws.send(JSON.stringify({
        type: 'subscribe',
        product_ids: Object.keys(productToAsset),
        channels: ['matches'],
      })),
      normalize: raw => normalizeCoinbase(raw, productToAsset),
    },
    binance: {
      url: () => cfg.binanceUrl + '?streams=' +
        Object.keys(symbolToAsset).map(s => s + '@trade').join('/'),
      hello: () => {},                         // subscription is in the URL
      normalize: raw => normalizeBinance(raw, symbolToAsset),
    },
  };

  const order = cfg.primary === 'binance' ? ['binance', 'coinbase'] : ['coinbase', 'binance'];
  let venueIdx = 0, failures = 0;
  let ws = null, backoff = cfg.reconnectMinMs, closed = false, lastMsgAt = 0;
  let watchdog = null;

  function venue() { return order[venueIdx % order.length]; }

  function connect() {
    if (closed) return;
    const v = VENUES[venue()];
    ws = new WS(v.url());
    let gotMsg = false;
    ws.onopen = () => { try { v.hello(ws); } catch (e) {} onStatus({ connected: true, venue: venue() }); };
    ws.onmessage = (ev) => {
      lastMsgAt = Date.now();
      if (!gotMsg) { gotMsg = true; failures = 0; backoff = cfg.reconnectMinMs; }
      let raw; try { raw = JSON.parse(ev.data); } catch (e) { return; }
      const m = v.normalize(raw);
      if (m) onPrice(m.asset, m.price, Date.now());
    };
    ws.onclose = () => {
      onStatus({ connected: false, venue: venue() });
      if (!gotMsg) failures++;
      if (failures >= ROTATE_AFTER) { venueIdx++; failures = 0; backoff = cfg.reconnectMinMs; onStatus({ rotated: true, venue: venue() }); }
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function scheduleReconnect() {
    if (closed) return;
    setTimeout(connect, backoff);
    backoff = Math.min(cfg.reconnectMaxMs, Math.round(backoff * 2 * (0.8 + Math.random() * 0.4)));
  }

  return {
    start() {
      closed = false;
      connect();
      // Quiet-socket watchdog: a connected feed with no trades for staleMsgMs
      // is dead in practice — kill it so the reconnect/rotate path runs.
      watchdog = setInterval(() => {
        if (lastMsgAt && Date.now() - lastMsgAt > cfg.staleMsgMs) {
          lastMsgAt = 0;
          failures++;
          try { ws && ws.close(); } catch (e) {}
        }
      }, Math.max(1000, cfg.staleMsgMs / 3));
      if (watchdog.unref) watchdog.unref();
    },
    close() { closed = true; clearInterval(watchdog); try { ws && ws.close(); } catch (e) {} },
    connected() { return !!(ws && ws.readyState === 1); },
    lastMsgAgoMs() { return lastMsgAt ? Date.now() - lastMsgAt : Infinity; },
    venue,
  };
}

module.exports = { createSpotSource, normalizeCoinbase, normalizeBinance };
