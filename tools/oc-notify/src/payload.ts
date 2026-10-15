/**
 * oc-notify payload builder — pure functions, zero dependencies.
 *
 * This module has no imports so it can load both inside the OpenCode plugin
 * runtime (bun) and under plain `node --test` without any build step.
 *
 * PRIVACY: envelopes carry only event type, session/permission ids, a short
 * human-readable message, and the server label. File contents, prompts,
 * tool arguments, and secrets are NEVER included.
 */

export type NotifyType = "permission" | "idle" | "error";

/** The notification envelope. Serialized as JSON into the ntfy `message`
 * field (the only structured carrier ntfy preserves verbatim); its keys are
 * ALSO mirrored as top-level publish-body fields for forward-compat (ntfy
 * currently strips unknown top-level fields — see buildNtfyBody). */
export interface NotifyEnvelope {
  type: NotifyType;
  server: string;
  sessionID: string;
  title: string;
  message: string;
  /** ISO-8601 timestamp of when the event fired. */
  at: string;
}

export interface NtfyConfig {
  /** Base URL of the ntfy server, e.g. http://<TAILSCALE-IP>:2586 */
  url: string;
  topic: string;
  token?: string;
  /** Human label for this machine, shown in notification titles. */
  server: string;
}

export const DEFAULT_SERVER_NAME = "workstation";
export const MAX_MESSAGE_LEN = 200;
export const MAX_ERROR_LEN = 160;

/** ntfy priority per notification type: permission=high(4), idle=default(3), error=high(4). */
export function ntfyPriority(type: NotifyType): number {
  switch (type) {
    case "permission":
      return 4;
    case "error":
      return 4;
    case "idle":
      return 3;
  }
}

export function ntfyTags(type: NotifyType): string[] {
  switch (type) {
    case "permission":
      return ["lock", "opencode"];
    case "error":
      return ["rotating_light", "opencode"];
    case "idle":
      return ["white_check_mark", "opencode"];
  }
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Read config strictly from env. Returns null when NTFY_URL/NTFY_TOPIC are
 * unset — the plugin must treat null as "disabled, send nothing".
 */
export function configFromEnv(
  env: Record<string, string | undefined>,
): NtfyConfig | null {
  const url = (env["NTFY_URL"] ?? "").trim().replace(/\/+$/, "");
  const topic = (env["NTFY_TOPIC"] ?? "").trim();
  if (!url || !topic) return null;
  const token = (env["NTFY_TOKEN"] ?? "").trim() || undefined;
  const server = (env["OC_SERVER_NAME"] ?? "").trim() || DEFAULT_SERVER_NAME;
  return { url, topic, token, server };
}

export interface BuildInput {
  type: NotifyType;
  server: string;
  sessionID: string;
  /** Short human summary, e.g. permission title or error name. Never raw content. */
  summary: string;
  now?: Date;
}

export function buildEnvelope(input: BuildInput): NotifyEnvelope {
  const at = (input.now ?? new Date()).toISOString();
  const sessionID = input.sessionID || "unknown";
  switch (input.type) {
    case "permission":
      return {
        type: "permission",
        server: input.server,
        sessionID,
        title: `[${input.server}] Permission needed`,
        message: truncate(input.summary || "Agent is asking for approval", MAX_MESSAGE_LEN),
        at,
      };
    case "idle":
      return {
        type: "idle",
        server: input.server,
        sessionID,
        title: `[${input.server}] Turn finished`,
        message: `Session ${shortID(sessionID)} is idle`,
        at,
      };
    case "error":
      return {
        type: "error",
        server: input.server,
        sessionID,
        title: `[${input.server}] Session error`,
        message: truncate(input.summary || "Session reported an error", MAX_MESSAGE_LEN),
        at,
      };
  }
}

export function shortID(sessionID: string): string {
  return sessionID.length > 8 ? sessionID.slice(0, 8) : sessionID;
}

/**
 * Build the ntfy JSON-publish body. `message` carries the JSON-encoded
 * envelope — this is the authoritative structured carrier.
 *
 * WHY `message` and not another field (verified live 2026-10-15 against the
 * self-hosted server):
 *   - Unknown top-level fields (`type`/`server`/`sessionID`/`at`) are
 *     silently DROPPED by ntfy (it decodes into a fixed struct), so they
 *     never reach subscribers. They are still sent as harmless
 *     forward-compat — if ntfy ever preserves them, the app parser prefers
 *     outer fields when both exist — but nothing may rely on them today.
 *   - `click`/`icon`/`actions` ARE preserved, but `click` holds a single URL
 *     string (wrong shape for a 6-field envelope) and the frozen app parser
 *     (opencode-phone/src/lib/ntfy.ts, read-only) does not read it — using
 *     it would need an app-side change. `message` is the only channel that
 *     is both preserved verbatim AND consumed by the parser, so it wins.
 *
 * TRADE-OFF: stock ntfy clients (e.g. the plain ntfy Android app) show the
 * raw JSON as the message body instead of prose. The human-readable text is
 * still inside the envelope's own `title`/`message` fields, and the
 * ntfy-level `title` stays human-readable (`[server] …`), but anyone reading
 * the stock app sees JSON, not a pretty sentence.
 */
export function buildNtfyBody(
  envelope: NotifyEnvelope,
  topic: string,
): Record<string, unknown> {
  return {
    topic,
    // Authoritative carrier: full envelope as JSON (full sessionID included).
    message: JSON.stringify(envelope),
    title: envelope.title,
    priority: ntfyPriority(envelope.type),
    tags: ntfyTags(envelope.type),
    // Forward-compat mirror (stripped by ntfy today, used by no one yet).
    type: envelope.type,
    server: envelope.server,
    sessionID: envelope.sessionID,
    at: envelope.at,
  };
}

export interface NtfyRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function buildNtfyRequest(
  envelope: NotifyEnvelope,
  config: NtfyConfig,
): NtfyRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;
  return {
    url: `${config.url}/`,
    headers,
    body: JSON.stringify(buildNtfyBody(envelope, config.topic)),
  };
}
