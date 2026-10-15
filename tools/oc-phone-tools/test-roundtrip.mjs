// test-roundtrip.mjs — contract pin + round-trip self-check for the oc-phone-qr payload.
//
// This file is the DECODER half of the contract: it implements parsing of
//   ocphone://connect?v=1&d=<base64url(JSON)>
// independently of oc-phone-qr (bash + node one-liner), so agreement between
// the two pins the frozen v1 spec. The app-side scanner should implement the
// same steps (see ../README.md "Payload contract (frozen: v1)").
//
// Usage:
//   node test-roundtrip.mjs --self-test            # fixture vectors, no secrets needed
//   node test-roundtrip.mjs '<ocphone://... URL>'  # verify a real payload from
//                                                  #   oc-phone-qr --print-payload
import { strict as assert } from "node:assert";

export function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}

export function b64urlEncode(s) {
  return Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodePayload(obj) {
  return "ocphone://connect?v=1&d=" + b64urlEncode(JSON.stringify(obj));
}

// Parse + validate a payload URL. Throws on any contract violation.
export function decodePayload(uri) {
  const u = new URL(uri.trim());
  assert.equal(u.protocol, "ocphone:", "scheme must be ocphone:");
  assert.equal(u.hostname, "connect", "host must be 'connect'");
  assert.equal(u.searchParams.get("v"), "1", "query v must be 1");
  const d = u.searchParams.get("d");
  assert.ok(d, "missing d parameter");
  assert.match(d, /^[A-Za-z0-9_-]+$/, "d must be base64url (no padding, URL-safe)");
  assert.ok(!/[+/=]/.test(d), "d must not contain + / or = (must be base64url, unpadded)");
  const obj = JSON.parse(b64urlDecode(d));
  assert.equal(obj.v, 1, "JSON v must be 1");
  for (const k of ["name", "url", "username", "bridgeUrl", "defaultProjectDir"]) {
    assert.equal(typeof obj[k], "string", `${k} must be a string`);
    assert.ok(obj[k].length > 0, `${k} must be non-empty`);
  }
  for (const k of ["password", "bridgeToken"]) {
    if (k in obj) assert.equal(typeof obj[k], "string", `${k} must be a string when present`);
  }
  assert.ok(obj.url.startsWith("http://") || obj.url.startsWith("https://"), "url must be http(s)");
  assert.ok(obj.bridgeUrl.startsWith("http://") || obj.bridgeUrl.startsWith("https://"), "bridgeUrl must be http(s)");
  return obj;
}

function selfTest() {
  // Vector 1: full payload round-trips exactly.
  const full = {
    v: 1, name: "myserver", url: "http://100.64.0.10:4096",
    username: "opencode", password: "SECRET-PW",
    bridgeUrl: "http://100.64.0.10:8787", bridgeToken: "SECRET-TOKEN",
    defaultProjectDir: "/home/user/Projects",
  };
  assert.deepEqual(decodePayload(encodePayload(full)), full);

  // Vector 2: --no-secrets payload has NO password/bridgeToken keys at all.
  const nosec = {
    v: 1, name: "myserver", url: "http://100.64.0.10:4096",
    username: "opencode", bridgeUrl: "http://100.64.0.10:8787",
    defaultProjectDir: "/home/user/Projects",
  };
  const rt = decodePayload(encodePayload(nosec));
  assert.deepEqual(rt, nosec);
  assert.ok(!("password" in rt) && !("bridgeToken" in rt));

  // Vector 3: base64url alphabet — no + / = anywhere in the URI.
  const tricky = { ...full, name: "üñí ☃ test", defaultProjectDir: "/home/a b/c" };
  const uri = encodePayload(tricky);
  assert.ok(!/[+/=]/.test(new URL(uri).searchParams.get("d")));
  assert.deepEqual(decodePayload(uri), tricky);

  // Vector 4: rejects wrong version / scheme / missing d.
  assert.throws(() => decodePayload("ocphone://connect?v=2&d=AAAA"));
  assert.throws(() => decodePayload("https://connect?v=1&d=AAAA"));
  assert.throws(() => decodePayload("ocphone://connect?v=1"));

  console.log("self-test: 4/4 vectors OK (encode/decode round-trip, no-secrets shape, base64url, rejections)");
}

const arg = process.argv[2];
if (arg === "--self-test" || arg === undefined) {
  selfTest();
} else {
  const obj = decodePayload(arg);
  // Print decoded shape with secrets redacted (key presence only).
  const redacted = { ...obj };
  if ("password" in redacted) redacted.password = `<${redacted.password.length} chars>`;
  if ("bridgeToken" in redacted) redacted.bridgeToken = `<${redacted.bridgeToken.length} chars>`;
  console.log(JSON.stringify(redacted, null, 2));
  console.log("decode OK: contract v1 valid.");
}
