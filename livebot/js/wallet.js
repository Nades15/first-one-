/* Livebot — wallet custody. The secret key is decoded once into a Keypair
 * and NEVER exposed: this module returns only { pubkey, signTx }. Nothing
 * here logs or serializes the secret. Live mode additionally refuses to arm
 * unless livebot/.env is both gitignored AND untracked. */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ENV_REL = 'livebot/.env';

/* Decode a base58 secret key into a signer. @solana/web3.js and bs58 are
 * required lazily so paper mode and the test suite never load them. */
function load(secretBase58) {
  const bs58 = require('bs58');
  const { Keypair } = require('@solana/web3.js');
  let secret;
  try {
    secret = bs58.decode(String(secretBase58).trim());
  } catch (e) {
    throw new Error('WALLET_SECRET_KEY is not valid base58.');
  }
  if (secret.length !== 64) {
    throw new Error('WALLET_SECRET_KEY must be a 64-byte base58 secret key (got ' + secret.length + ' bytes).');
  }
  const keypair = Keypair.fromSecretKey(secret);
  const pubkey = keypair.publicKey.toBase58();

  return {
    pubkey,
    /* Sign a VersionedTransaction (or legacy Transaction) in place. */
    signTx(tx) {
      if (typeof tx.sign === 'function') {
        try { tx.sign([keypair]); }         // VersionedTransaction
        catch (e) { tx.sign(keypair); }     // legacy Transaction
      } else if (typeof tx.partialSign === 'function') {
        tx.partialSign(keypair);
      } else {
        throw new Error('unsignable transaction object');
      }
      return tx;
    },
    keypair,                                 // for @solana/web3.js calls that need the signer
  };
}

/* True only if `.env` is ignored by git AND not tracked. Returns a structured
 * result so callers can print precise remediation. Never throws. */
function assertSafe() {
  const result = { safe: false, ignored: false, tracked: true, reasons: [] };
  try {
    execFileSync('git', ['check-ignore', '-q', ENV_REL], { cwd: REPO_ROOT });
    result.ignored = true;
  } catch (e) {
    result.reasons.push('livebot/.env is NOT gitignored — add it to .gitignore before continuing.');
  }
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', ENV_REL], { cwd: REPO_ROOT, stdio: 'ignore' });
    result.reasons.push('livebot/.env IS tracked by git — run: git rm --cached livebot/.env');
  } catch (e) {
    result.tracked = false;               // not tracked → good
  }
  result.safe = result.ignored && !result.tracked;
  return result;
}

module.exports = { load, assertSafe, ENV_REL };
