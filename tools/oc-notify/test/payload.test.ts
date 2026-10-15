import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEnvelope,
  buildNtfyBody,
  buildNtfyRequest,
  configFromEnv,
  ntfyPriority,
  ntfyTags,
  shortID,
  truncate,
  MAX_MESSAGE_LEN,
} from "../src/payload.ts";

describe("configFromEnv", () => {
  it("returns null when NTFY_URL is unset (no-op behaviour)", () => {
    assert.equal(configFromEnv({ NTFY_TOPIC: "x" }), null);
  });
  it("returns null when NTFY_TOPIC is unset (no-op behaviour)", () => {
    assert.equal(configFromEnv({ NTFY_URL: "http://x:2586" }), null);
  });
  it("returns null when both are unset", () => {
    assert.equal(configFromEnv({}), null);
  });
  it("returns null for blank values", () => {
    assert.equal(configFromEnv({ NTFY_URL: "  ", NTFY_TOPIC: "" }), null);
  });
  it("builds config from env, trimming trailing slashes", () => {
    const cfg = configFromEnv({
      NTFY_URL: "http://100.64.0.10:2586///",
      NTFY_TOPIC: "oc-test",
    });
    assert.deepEqual(cfg, {
      url: "http://100.64.0.10:2586",
      topic: "oc-test",
      token: undefined,
      server: "workstation",
    });
  });
  it("picks up optional NTFY_TOKEN and OC_SERVER_NAME", () => {
    const cfg = configFromEnv({
      NTFY_URL: "https://ntfy.sh",
      NTFY_TOPIC: "oc-test",
      NTFY_TOKEN: "tk_abc",
      OC_SERVER_NAME: "rig",
    });
    assert.equal(cfg?.token, "tk_abc");
    assert.equal(cfg?.server, "rig");
  });
});

describe("priorities and tags", () => {
  it("permission ask = high(4), idle = default(3), error = high(4)", () => {
    assert.equal(ntfyPriority("permission"), 4);
    assert.equal(ntfyPriority("idle"), 3);
    assert.equal(ntfyPriority("error"), 4);
  });
  it("tags are non-empty strings per type", () => {
    for (const t of ["permission", "idle", "error"] as const) {
      const tags = ntfyTags(t);
      assert.ok(tags.length > 0);
      assert.ok(tags.every((x) => typeof x === "string" && x.length > 0));
    }
  });
});

describe("buildEnvelope", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  it("permission envelope has the required shape", () => {
    const e = buildEnvelope({
      type: "permission",
      server: "rig",
      sessionID: "ses_1234567890",
      summary: "bash (edit)",
      now,
    });
    assert.deepEqual(e, {
      type: "permission",
      server: "rig",
      sessionID: "ses_1234567890",
      title: "[rig] Permission needed",
      message: "bash (edit)",
      at: "2026-10-14T00:00:00.000Z",
    });
  });
  it("idle envelope never carries summaries", () => {
    const e = buildEnvelope({
      type: "idle",
      server: "rig",
      sessionID: "ses_1234567890",
      summary: "should-be-ignored",
      now,
    });
    assert.equal(e.title, "[rig] Turn finished");
    assert.ok(!e.message.includes("should-be-ignored"));
  });
  it("error envelope truncates long messages", () => {
    const e = buildEnvelope({
      type: "error",
      server: "rig",
      sessionID: "s",
      summary: "x".repeat(500),
      now,
    });
    assert.ok(e.message.length <= MAX_MESSAGE_LEN);
  });
  it("falls back when sessionID is empty", () => {
    const e = buildEnvelope({ type: "idle", server: "rig", sessionID: "", summary: "", now });
    assert.equal(e.sessionID, "unknown");
  });
});

describe("ntfy request", () => {
  it("POSTs to server root with topic in JSON body", () => {
    const envelope = buildEnvelope({
      type: "permission",
      server: "rig",
      sessionID: "ses_1",
      summary: "bash (allow?)",
      now: new Date("2026-10-14T00:00:00.000Z"),
    });
    const req = buildNtfyRequest(envelope, {
      url: "http://100.64.0.10:2586",
      topic: "oc-test",
      server: "rig",
    });
    assert.equal(req.url, "http://100.64.0.10:2586/");
    assert.equal(req.headers["Content-Type"], "application/json");
    assert.ok(!("Authorization" in req.headers));
    const body = JSON.parse(req.body);
    assert.equal(body.topic, "oc-test");
    // message is the JSON-encoded envelope (the carrier ntfy preserves)
    assert.equal(body.title, envelope.title);
    const embedded = JSON.parse(body.message);
    assert.deepEqual(embedded, {
      type: "permission",
      server: "rig",
      sessionID: "ses_1",
      title: envelope.title,
      message: envelope.message,
      at: "2026-10-14T00:00:00.000Z",
    });
    assert.equal(body.priority, 4);
    assert.deepEqual(body.tags, ["lock", "opencode"]);
    // forward-compat top-level mirror (stripped by ntfy today)
    assert.equal(body.type, "permission");
    assert.equal(body.server, "rig");
    assert.equal(body.sessionID, "ses_1");
    assert.equal(body.at, "2026-10-14T00:00:00.000Z");
  });
  it("adds Bearer auth when NTFY_TOKEN is set", () => {
    const envelope = buildEnvelope({
      type: "idle",
      server: "rig",
      sessionID: "s",
      summary: "",
    });
    const req = buildNtfyRequest(envelope, {
      url: "https://ntfy.sh",
      topic: "t",
      token: "tk_abc",
      server: "rig",
    });
    assert.equal(req.headers["Authorization"], "Bearer tk_abc");
  });
  it("buildNtfyBody keeps the {type,server,sessionID,title,message,at} envelope intact", () => {
    const envelope = buildEnvelope({
      type: "error",
      server: "rig",
      sessionID: "ses_9",
      summary: "boom",
    });
    const body = buildNtfyBody(envelope, "t") as Record<string, unknown>;
    for (const k of ["type", "server", "sessionID", "title", "message", "at"]) {
      assert.ok(k in body, `missing ${k}`);
    }
  });
  it("message carries the full envelope as JSON with the FULL sessionID", () => {
    const envelope = buildEnvelope({
      type: "permission",
      server: "rig",
      sessionID: "ses_abcdef1234567890",
      summary: "bash (edit)",
    });
    const body = buildNtfyBody(envelope, "t") as Record<string, unknown>;
    assert.equal(typeof body.message, "string");
    const embedded = JSON.parse(body.message as string) as Record<string, unknown>;
    assert.deepEqual(embedded, {
      type: "permission",
      server: "rig",
      sessionID: "ses_abcdef1234567890",
      title: envelope.title,
      message: envelope.message,
      at: envelope.at,
    });
    // full id, never the truncated shortID used in idle prose
    assert.ok(!(embedded.sessionID as string).endsWith("…"));
    assert.equal(embedded.sessionID, "ses_abcdef1234567890");
    // ntfy-level title stays human-readable for stock clients
    assert.equal(body.title, "[rig] Permission needed");
  });
  it("embedded envelope only uses types the app parser accepts", () => {
    for (const t of ["permission", "idle", "error"] as const) {
      const envelope = buildEnvelope({ type: t, server: "rig", sessionID: "s", summary: "x" });
      const body = buildNtfyBody(envelope, "t") as Record<string, unknown>;
      const embedded = JSON.parse(body.message as string) as Record<string, unknown>;
      assert.ok(["permission", "idle", "error"].includes(embedded.type as string));
      for (const k of ["type", "server", "sessionID", "title", "message", "at"]) {
        assert.equal(typeof embedded[k], "string", `${t}: embedded.${k} must be a string`);
      }
    }
  });
});

describe("helpers", () => {
  it("truncate shortens with ellipsis", () => {
    assert.equal(truncate("abcdef", 5), "abcd…");
    assert.equal(truncate("abc", 5), "abc");
  });
  it("shortID keeps first 8 chars", () => {
    assert.equal(shortID("ses_1234567890"), "ses_1234");
    assert.equal(shortID("abc"), "abc");
  });
});
