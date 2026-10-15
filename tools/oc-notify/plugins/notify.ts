/**
 * oc-notify — OpenCode plugin: phone notifications via self-hosted ntfy.
 *
 * Fires on:
 *   - permission.updated  (agent blocked asking for approval)
 *   - session.idle        (agent finished a turn)
 *   - session.error       (session reported an error)
 *
 * Design constraints:
 *   - Config strictly via env (NTFY_URL, NTFY_TOPIC, NTFY_TOKEN?, OC_SERVER_NAME?).
 *   - Unset NTFY_URL/NTFY_TOPIC => silent no-op. NOTHING is sent, nothing throws.
 *   - Every code path is wrapped so a broken notifier can NEVER break a
 *     coding session: all errors are swallowed.
 *   - PRIVACY: only event type, ids, a short derived message, and the server
 *     label leave the machine. No file contents, prompts, tool args, secrets.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  buildEnvelope,
  buildNtfyRequest,
  configFromEnv,
  truncate,
  type NotifyType,
} from "../src/payload.ts";

/** Per-session cooldown (ms) for idle/error events to avoid notification spam. */
const COOLDOWN_MS = 30_000;
/** Cap on remembered permission ids (dedupe set). */
const MAX_SEEN_PERMISSIONS = 1000;
const FETCH_TIMEOUT_MS = 5000;

async function postNtfy(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

type PendingNotice = { type: NotifyType; sessionID: string; summary: string } | null;

/** Extract a short, safe summary from an event. Never includes raw content. */
function summarizeEvent(event: { type: string; properties: any }): PendingNotice {
  const props = event.properties ?? {};
  switch (event.type) {
    case "permission.updated": {
      // properties is a Permission: {id, type, title, sessionID, ...}
      if (typeof props.id !== "string") return null;
      const kind = typeof props.type === "string" ? props.type : "permission";
      const title = typeof props.title === "string" ? props.title : "";
      const summary = title ? `${title} (${kind})` : `Approval requested (${kind})`;
      return {
        type: "permission",
        sessionID: typeof props.sessionID === "string" ? props.sessionID : "unknown",
        summary: `__perm:${props.id}__${summary}`,
      };
    }
    case "session.idle": {
      if (typeof props.sessionID !== "string") return null;
      return { type: "idle", sessionID: props.sessionID, summary: "" };
    }
    case "session.error": {
      const sessionID =
        typeof props.sessionID === "string" ? props.sessionID : "unknown";
      return { type: "error", sessionID, summary: summaryError(props.error) };
    }
    default:
      return null;
  }
}

/** Derive a short error label without leaking payloads. Max 160 chars downstream. */
function summaryError(error: unknown): string {
  if (!error || typeof error !== "object") return "Session reported an error";
  const rec = error as Record<string, unknown>;
  const name =
    (typeof rec["type"] === "string" && rec["type"]) ||
    (typeof rec["name"] === "string" && rec["name"]) ||
    "error";
  const msg = typeof rec["message"] === "string" ? rec["message"] : "";
  return msg ? `${name}: ${msg}` : `Session reported an error (${name})`;
}

export const NotifyPlugin: Plugin = async () => {
  const seenPermissions = new Set<string>();
  const lastNoticeBySession = new Map<string, number>();

  return {
    event: async ({ event }) => {
      try {
        const config = configFromEnv(process.env);
        if (!config) return; // no-op when unconfigured

        const notice = summarizeEvent(
          event as { type: string; properties: any },
        );
        if (!notice) return;

        if (notice.type === "permission") {
          // summary carries "__perm:<id>__<text>" (id never leaves the machine)
          const match = /^__perm:(.*?)__(.*)$/s.exec(notice.summary);
          if (!match) return;
          const [, permId, text] = match;
          if (seenPermissions.has(permId)) return; // reply/update duplicates
          seenPermissions.add(permId);
          if (seenPermissions.size > MAX_SEEN_PERMISSIONS) {
            const oldest = seenPermissions.values().next();
            if (!oldest.done) seenPermissions.delete(oldest.value);
          }
          const envelope = buildEnvelope({
            type: "permission",
            server: config.server,
            sessionID: notice.sessionID,
            summary: truncate(text, 200),
          });
          const req = buildNtfyRequest(envelope, config);
          await postNtfy(req.url, req.headers, req.body);
          return;
        }

        // idle / error: per-session cooldown against flapping
        const key = `${notice.type}:${notice.sessionID}`;
        const now = Date.now();
        const last = lastNoticeBySession.get(key) ?? 0;
        if (now - last < COOLDOWN_MS) return;
        lastNoticeBySession.set(key, now);

        const envelope = buildEnvelope({
          type: notice.type,
          server: config.server,
          sessionID: notice.sessionID,
          summary: notice.summary,
        });
        const req = buildNtfyRequest(envelope, config);
        await postNtfy(req.url, req.headers, req.body);
      } catch {
        // A broken notifier must never break a coding session.
      }
    },
  };
};
