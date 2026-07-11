/* Summit — freemium logic: daily cap and unlock codes. No DOM — runs in
 * node for tests and in the browser as window.SMPremium.
 *
 * ⚠ STUB PAYWALL. Codes are checked by a client-side checksum, so anyone
 * who reads this file can mint one — that's fine for a pre-revenue build
 * (testing, gifting, beta access) but it is NOT a payment system. When real
 * money arrives (Stripe on web, StoreKit/Play Billing once wrapped for the
 * app stores), replace redeem-code with a server/store-verified entitlement;
 * everything else already gates through capInfo() and the stored flag. */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.SMPremium = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CODE_PREFIX = 'SUMMIT';
  const CHECK_LEN = 4;
  const CHECK_SPACE = Math.pow(36, CHECK_LEN);

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h;
  }

  function checksum(payload, salt) {
    return (djb2(payload + '|' + salt) % CHECK_SPACE)
      .toString(36).toUpperCase().padStart(CHECK_LEN, '0');
  }

  /* Mint a code: SUMMIT-<PAYLOAD>-<CHECK>. Payload is any A–Z0–9 tag you
   * like (batch name, friend's name…), 4+ chars. */
  function makeCode(payload, salt) {
    const p = String(payload || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p.length < 4) return null;
    return CODE_PREFIX + '-' + p + '-' + checksum(p, salt);
  }

  function validateCode(code, salt) {
    const parts = String(code || '').trim().toUpperCase().split(/[\s-]+/).filter(Boolean);
    if (parts.length !== 3 || parts[0] !== CODE_PREFIX) return false;
    const payload = parts[1].replace(/[^A-Z0-9]/g, '');
    if (payload.length < 4 || parts[1] !== payload) return false;
    return parts[2] === checksum(payload, salt);
  }

  /* Free accounts get `cap` questions per (local) day; premium is uncapped. */
  function capInfo(todayCount, premiumActive, cap) {
    if (premiumActive) return { capped: false, remaining: Infinity };
    const remaining = Math.max(0, cap - todayCount);
    return { capped: remaining <= 0, remaining };
  }

  return { CODE_PREFIX, makeCode, validateCode, capInfo };
});
