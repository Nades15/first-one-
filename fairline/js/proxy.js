/* Fairline — optional egress-proxy support. Some environments (corporate
 * networks, sandboxed cloud runners) only allow outbound HTTPS through a
 * CONNECT proxy announced via HTTPS_PROXY. curl honors that automatically;
 * Node's fetch and the ws client do not, so when HTTPS_PROXY is set this
 * builds a proxied fetch and a proxied WebSocket to inject into the
 * pipeline's fetchImpl / WebSocketImpl seams. Without HTTPS_PROXY (a normal
 * home machine) it returns {} and everything uses the defaults.
 *
 * TLS note: intercepting proxies present their own CA — launch node with
 * NODE_EXTRA_CA_CERTS pointed at that CA bundle if handshakes fail. */
'use strict';

function proxySupport(env) {
  const e = env || process.env;
  const proxyUrl = e.HTTPS_PROXY || e.https_proxy;
  if (!proxyUrl) return {};
  const out = { proxyUrl };

  try {
    // undici's own fetch, not the global one — Node's built-in fetch bundles
    // its own undici and rejects a dispatcher built by a different version.
    const { fetch: ufetch, ProxyAgent } = require('undici');
    const dispatcher = new ProxyAgent(proxyUrl);
    out.fetchImpl = (url, opts) => ufetch(url, Object.assign({ dispatcher }, opts));
  } catch (err) { out.fetchErr = err.message; }

  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const WS = require('ws');
    const agent = new HttpsProxyAgent(proxyUrl);
    out.WebSocketImpl = class ProxiedWebSocket extends WS {
      constructor(url, protocols) { super(url, protocols, { agent }); }
    };
  } catch (err) { out.wsErr = err.message; }

  return out;
}

module.exports = { proxySupport };
