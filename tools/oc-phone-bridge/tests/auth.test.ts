import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBearerToken, isAuthorized, tokensEqual } from '../src/auth.js';
import { loadConfig } from '../src/config.js';

const TOKEN = 'a'.repeat(32);

describe('auth: bearer parsing', () => {
  it('extracts a Bearer token', () => {
    assert.equal(getBearerToken('Bearer abc123'), 'abc123');
  });
  it('scheme is case-insensitive', () => {
    assert.equal(getBearerToken('bearer abc123'), 'abc123');
  });
  it('returns null for missing/empty/malformed headers', () => {
    assert.equal(getBearerToken(null), null);
    assert.equal(getBearerToken(undefined), null);
    assert.equal(getBearerToken(''), null);
    assert.equal(getBearerToken('Bearer '), null);
    assert.equal(getBearerToken('Basic abc123'), null);
    assert.equal(getBearerToken('abc123'), null);
  });
});

describe('auth: authorization', () => {
  it('accepts the exact token', () => {
    assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
  });
  it('rejects wrong, missing, and malformed credentials', () => {
    assert.equal(isAuthorized(`Bearer ${'b'.repeat(32)}`, TOKEN), false);
    assert.equal(isAuthorized(`Bearer ${TOKEN}x`, TOKEN), false);
    assert.equal(isAuthorized(null, TOKEN), false);
    assert.equal(isAuthorized('Basic whatever', TOKEN), false);
  });
  it('compares in constant time (equal-length digests, no length leak)', () => {
    // tokensEqual hashes both sides, so short vs long inputs still compare safely.
    assert.equal(tokensEqual(TOKEN, TOKEN), true);
    assert.equal(tokensEqual('short', TOKEN), false);
    assert.equal(tokensEqual(TOKEN, TOKEN.toUpperCase()), false);
  });
});

describe('config: startup token requirement', () => {
  it('refuses to start without OC_BRIDGE_TOKEN', () => {
    assert.throws(() => loadConfig({}), /OC_BRIDGE_TOKEN is required/);
  });
  it('refuses tokens shorter than 32 chars', () => {
    assert.throws(() => loadConfig({ OC_BRIDGE_TOKEN: 'too-short' }), /at least 32/);
    assert.throws(() => loadConfig({ OC_BRIDGE_TOKEN: 'x'.repeat(31) }), /at least 32/);
  });
  it('accepts a 32-char token and applies defaults', () => {
    const cfg = loadConfig({ OC_BRIDGE_TOKEN: TOKEN });
    assert.equal(cfg.token, TOKEN);
    assert.equal(cfg.host, '127.0.0.1');
    assert.equal(cfg.port, 8787);
    assert.ok(cfg.allowedRoots.length >= 1);
  });
  it('rejects invalid ports', () => {
    assert.throws(() => loadConfig({ OC_BRIDGE_TOKEN: TOKEN, OC_BRIDGE_PORT: 'abc' }), /OC_BRIDGE_PORT/);
    assert.throws(() => loadConfig({ OC_BRIDGE_TOKEN: TOKEN, OC_BRIDGE_PORT: '0' }), /OC_BRIDGE_PORT/);
    assert.throws(() => loadConfig({ OC_BRIDGE_TOKEN: TOKEN, OC_BRIDGE_PORT: '99999' }), /OC_BRIDGE_PORT/);
  });
});
