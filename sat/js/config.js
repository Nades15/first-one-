/* Summit — endpoints, sections, freemium and pricing config. */
window.SMConfig = (function () {
  'use strict';

  /*
   * College Board's public SAT Suite Question Bank API — the same no-auth
   * endpoints that power satsuitequestionbank.collegeboard.org. Every
   * question served by Summit comes from here: bank.js downloads them in
   * the browser, tools/fetch-bank.mjs downloads them from node. If the
   * API refuses browser calls (CORS), bank.js retries through the proxy
   * configured in Settings.
   */
  const QBANK_API = 'https://qbank-api.collegeboard.org/msreportingquestionbank/questionbank/digital';
  const ASMT_EVENT_ID = 99;                                  // digital SAT
  const DEFAULT_CORS_PROXY = 'https://corsproxy.io/?url=';

  const SECTIONS = {
    rw:   { label: 'Reading & Writing', test: 1, domains: 'INI,CAS,EOI,SEC' },
    math: { label: 'Math',              test: 2, domains: 'H,P,Q,S' },
  };

  const DOMAIN_NAMES = {
    INI: 'Information and Ideas',
    CAS: 'Craft and Structure',
    EOI: 'Expression of Ideas',
    SEC: 'Standard English Conventions',
    H: 'Algebra',
    P: 'Advanced Math',
    Q: 'Problem-Solving & Data Analysis',
    S: 'Geometry & Trigonometry',
  };

  /* Freemium: free accounts get this many adaptive questions per day —
   * answers and official rationales included. Premium lifts the cap and
   * unlocks mocks, score prediction, and weakness analytics. */
  const FREE_DAILY_CAP = 10;

  /* One digital-SAT module each (question count / minutes). */
  const MOCKS = {
    rw:   { questions: 27, minutes: 32 },
    math: { questions: 22, minutes: 35 },
  };

  /* Display copy only — no payment rails yet. The upgrade screen redeems
   * unlock codes (see premium.js); Stripe or store IAP slots in later. */
  const PRICING = {
    monthly: { price: '$4.99',  per: '/month' },
    yearly:  { price: '$29.99', per: '/year', tag: 'save 50%' },
  };

  /* Salt for the stub unlock-code checksum (premium.js). Changing it
   * invalidates every previously issued code. */
  const CODE_SALT = 'summit-v1';

  return {
    QBANK_API, ASMT_EVENT_ID, DEFAULT_CORS_PROXY,
    SECTIONS, DOMAIN_NAMES, FREE_DAILY_CAP, MOCKS, PRICING, CODE_SALT,
  };
})();
