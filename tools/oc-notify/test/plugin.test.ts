/**
 * Plugin wiring tests: drive NotifyPlugin.event() against a real local HTTP
 * stub server (no mocks for fetch) and assert the no-op path sends nothing.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Received = { url: string; headers: Record<string, string>; body: string };
let received: Received[] = [];
let server: http.Server;
let baseUrl = "";

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers[k] = v;
          }
          received.push({ url: req.url ?? "", headers, body: data });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        });
      });
      server.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    }),
);

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function setEnv(env: Record<string, string | undefined>) {
  for (const k of ["NTFY_URL", "NTFY_TOPIC", "NTFY_TOKEN", "OC_SERVER_NAME"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
}

async function loadPlugin() {
  const mod = await import("../plugins/notify.ts");
  const hooks = await mod.NotifyPlugin({} as any);
  assert.ok(typeof hooks.event === "function");
  return hooks.event!;
}

describe("plugin no-op behaviour", () => {
  it("sends nothing when env is unset and never throws", async () => {
    setEnv({});
    received = [];
    const onEvent = await loadPlugin();
    await onEvent({ event: { type: "session.idle", properties: { sessionID: "s1" } } } as any);
    await onEvent({ event: { type: "session.error", properties: { sessionID: "s1" } } } as any);
    await onEvent({
      event: {
        type: "permission.updated",
        properties: { id: "p1", type: "bash", title: "run", sessionID: "s1" },
      },
    } as any);
    assert.equal(received.length, 0);
  });

  it("ignores unrelated event types", async () => {
    setEnv({ NTFY_URL: baseUrl, NTFY_TOPIC: "t" });
    received = [];
    const onEvent = await loadPlugin();
    await onEvent({ event: { type: "session.created", properties: {} } } as any);
    await onEvent({ event: { type: "message.updated", properties: {} } } as any);
    assert.equal(received.length, 0);
  });
});

describe("plugin notify behaviour (real HTTP to stub)", () => {
  it("POSTs permission/idle/error JSON with the envelope shape", async () => {
    setEnv({ NTFY_URL: baseUrl, NTFY_TOPIC: "oc-test", OC_SERVER_NAME: "rig" });
    received = [];
    const onEvent = await loadPlugin();
    await onEvent({
      event: {
        type: "permission.updated",
        properties: { id: "perm-1", type: "bash", title: "Run tests", sessionID: "ses_abc" },
      },
    } as any);
    await onEvent({ event: { type: "session.idle", properties: { sessionID: "ses_abc" } } } as any);
    await onEvent({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_abc", error: { name: "ApiError", message: "boom" } },
      },
    } as any);

    assert.equal(received.length, 3);
    for (const r of received) {
      assert.equal(r.url, "/");
      assert.equal(r.headers["content-type"], "application/json");
      const body = JSON.parse(r.body);
      assert.equal(body.topic, "oc-test");
      for (const k of ["type", "server", "sessionID", "title", "message", "at"]) {
        assert.ok(k in body, `missing ${k}`);
      }
      assert.equal(body.server, "rig");
    }
    const [perm, idle, err] = received.map((r) => JSON.parse(r.body));
    assert.equal(perm.type, "permission");
    assert.ok((perm.message as string).includes("Run tests"));
    assert.ok(!(perm.message as string).includes("perm-1"), "permission id must not leak");
    assert.equal(idle.type, "idle");
    assert.equal(err.type, "error");
    assert.ok((err.message as string).includes("boom"));
    // the app parser's carrier: message parses as the full envelope
    for (const [posted, type] of [[perm, "permission"], [idle, "idle"], [err, "error"]] as const) {
      const embedded = JSON.parse(posted.message);
      assert.equal(embedded.type, type);
      assert.equal(embedded.server, "rig");
      assert.equal(typeof embedded.sessionID, "string");
      assert.ok(embedded.sessionID.length > 0);
      assert.equal(typeof embedded.title, "string");
      assert.equal(typeof embedded.message, "string");
      assert.equal(typeof embedded.at, "string");
    }
    assert.equal(JSON.parse(perm.message).sessionID, "ses_abc");
  });

  it("dedupes repeated permission.updated for the same permission id", async () => {
    setEnv({ NTFY_URL: baseUrl, NTFY_TOPIC: "oc-test" });
    received = [];
    const onEvent = await loadPlugin();
    const evt = {
      event: {
        type: "permission.updated",
        properties: { id: "dup-1", type: "edit", title: "Edit f", sessionID: "s" },
      },
    } as any;
    await onEvent(evt);
    await onEvent(evt);
    assert.equal(received.length, 1);
  });

  it("cools down rapid idle repeats for the same session", async () => {
    setEnv({ NTFY_URL: baseUrl, NTFY_TOPIC: "oc-test" });
    received = [];
    const onEvent = await loadPlugin();
    const evt = { event: { type: "session.idle", properties: { sessionID: "s-cool" } } } as any;
    await onEvent(evt);
    await onEvent(evt);
    assert.equal(received.length, 1);
  });

  it("never throws when the ntfy server is unreachable", async () => {
    setEnv({ NTFY_URL: "http://127.0.0.1:1", NTFY_TOPIC: "oc-test" });
    const onEvent = await loadPlugin();
    await onEvent({ event: { type: "session.idle", properties: { sessionID: "s" } } } as any);
  });
});
