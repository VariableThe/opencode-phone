package cc.agentlabs.opencode

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

// Native session monitor: an Android foreground service (dataSync type) that
// polls the opencode server for watched sessions and raises local
// notifications for finished / failed / needs-input outcomes.
//
// Why native instead of JS: Android freezes the React Native JS runtime
// minutes after backgrounding (Doze/app standby) and kills it with the app —
// no JS timer, SSE stream, or expo-background-fetch task can deliver timely
// alerts then. A foreground service is the only mechanism that keeps running,
// at the documented cost of a persistent notification and extra battery use.
//
// Design notes:
// - ONE service instance polls EVERY watched connection (targets arrive as a
//   JSON array in the start intent), mirroring the JS background evaluator's
//   per-connection keying (stores/session-watch.ts).
// - Settlement rules mirror lib/session-settlement.ts: finished + failed +
//   needs-input (permission/form) notify; aborted/in-progress never do.
//   Dedupe keys use the identical `watch:<conn>:<sess>:<state>[:prompt]`
//   scheme, persisted in SharedPreferences so a service restart cannot re-fire.
// - START_REDELIVER_INTENT: if the OS kills the service, it restarts with the
//   same config (base URLs + Basic-auth credentials stay in memory only, never
//   on disk — a reboot requires reopening the app, which re-sends them).
// - Taps carry the non-secret route (sessionId + connectionId) as an
//   `opencode://session/<id>?connectionId=<cid>` deep link; expo-router
//   resolves it and the JS tap handler switches to the owning connection.
// - v1 servers are supported best-effort (global /permission + /question
//   lists filtered by sessionID, flat /session/{id}/message tail).

class SessionMonitorService : Service() {

  companion object {
    const val ACTION_START = "cc.agentlabs.opencode.monitor.START"
    const val ACTION_STOP = "cc.agentlabs.opencode.monitor.STOP"
    const val EXTRA_BASE_URL = "baseUrl"
    const val EXTRA_TARGETS = "targets"
    const val EXTRA_INTERVAL_SEC = "intervalSec"
    const val MONITOR_CHANNEL = "oc-monitor"
    const val ALERTS_CHANNEL = "oc-alerts"
    const val ONGOING_ID = 1001
    const val TAG = "SessionMonitor"
    val running = AtomicBoolean(false)
  }

  private var worker: Thread? = null
  @Volatile private var stopRequested = false
  private var targetsJson = "[]"
  private var intervalSec = 60

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannels()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stop()
      return START_NOT_STICKY
    }
    targetsJson = intent?.getStringExtra(EXTRA_TARGETS) ?: targetsJson
    intervalSec = intent?.getIntExtra(EXTRA_INTERVAL_SEC, 60)?.coerceAtLeast(30) ?: intervalSec
    stopRequested = false
    startForegroundWithType()
    running.set(true)
    if (worker?.isAlive != true) {
      worker = Thread({ loop() }, "oc-monitor").also { it.start() }
    } else {
      refreshOngoing()
    }
    // Redeliver the same config if the OS kills us — the poll loop resumes
    // without the app having to reopen.
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    stopRequested = true
    worker?.interrupt()
    worker = null
    running.set(false)
    super.onDestroy()
  }

  private fun stop() {
    stopRequested = true
    worker?.interrupt()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    running.set(false)
  }

  private fun ensureChannels() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(MONITOR_CHANNEL, "Session monitoring", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Persistent status while watched agent sessions are polled in the background."
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(ALERTS_CHANNEL, "Session alerts", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Finished, failed and needs-input alerts for watched agent sessions."
      },
    )
  }

  private fun startForegroundWithType() {
    val note = ongoingNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(ONGOING_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(ONGOING_ID, note)
    }
  }

  private fun watchCount(): Int {
    return try {
      JSONArray(targetsJson).let { targets ->
        var n = 0
        for (i in 0 until targets.length()) {
          n += targets.optJSONObject(i)?.optJSONArray("sessions")?.length() ?: 0
        }
        n
      }
    } catch (_: Exception) {
      0
    }
  }

  private fun ongoingNotification(): Notification {
    val tap = PendingIntent.getActivity(
      this, 0,
      Intent(this, MainActivity::class.java).apply { action = Intent.ACTION_MAIN },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, MONITOR_CHANNEL)
      .setContentTitle("Watching ${watchCount()} session(s)")
      .setContentText("Checking for completion while the app is closed.")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setContentIntent(tap)
      .build()
  }

  private fun refreshOngoing() {
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .notify(ONGOING_ID, ongoingNotification())
  }

  private fun loop() {
    while (!stopRequested) {
      try {
        pollAll()
      } catch (err: Exception) {
        Log.w(TAG, "poll failed: ${err.message}")
      }
      try {
        Thread.sleep(intervalSec * 1000L)
      } catch (_: InterruptedException) {
        break
      }
    }
  }

  private fun pollAll() {
    val targets = try {
      JSONArray(targetsJson)
    } catch (_: Exception) {
      return
    }
    for (i in 0 until targets.length()) {
      if (stopRequested) return
      val target = targets.optJSONObject(i) ?: continue
      pollTarget(target)
    }
  }

  private fun pollTarget(target: JSONObject) {
    val base = target.optString("baseUrl").trimEnd('/')
    val connectionId = target.optString("connectionId")
    val username = target.optString("username", "")
    val password = target.optString("password", "")
    val api = target.optString("api", "v2")
    val sessions = target.optJSONArray("sessions") ?: return
    if (base.isEmpty() || connectionId.isEmpty() || sessions.length() == 0) return
    val auth = if (username.isNotEmpty()) {
      "Basic " + Base64.encodeToString("$username:$password".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    } else {
      null
    }
    for (i in 0 until sessions.length()) {
      if (stopRequested) return
      val row = sessions.optJSONObject(i) ?: continue
      val sessionId = row.optString("sessionId")
      if (sessionId.isEmpty()) continue
      try {
        pollSession(base, api, auth, connectionId, sessionId, row.optString("title", ""))
      } catch (err: Exception) {
        Log.w(TAG, "session $sessionId: ${err.message}")
      }
    }
  }

  private fun pollSession(base: String, api: String, auth: String?, connectionId: String, sessionId: String, title: String) {
    // Needs-input first: a pending prompt means the agent is blocked on the
    // user, which outranks any busy/idle signal (same rule as
    // classifySettlement: blocked wins).
    val pending = pendingPrompts(base, api, auth, sessionId)
    if (pending != null) {
      var fired = false
      for (prompt in pending) {
        val key = "watch:$connectionId:$sessionId:blocked:${prompt.id}"
        if (isSeen(key)) continue
        markSeen(key)
        alert(
          prompt.title,
          prompt.body,
          sessionId,
          connectionId,
          prompt.id.hashCode(),
        )
        fired = true
      }
      if (fired) return
      // Prompts outstanding but all already announced — stay silent, keep the
      // session watched (resolution re-arms via a fresh prompt id).
      if (pending.isNotEmpty()) return
    }
    // No prompts (or list reads failed and returned null): terminal evidence
    // from the message tail. A null read is a network/auth failure, not proof
    // of activity — keep watching silently.
    val tail = messageTail(base, api, auth, sessionId) ?: return
    if (tail.deleted) return // dropped silently: deleted sessions never alert
    if (!tail.terminal) return
    val outcome = if (tail.errored) "failed" else "finished"
    val key = "watch:$connectionId:$sessionId:$outcome"
    if (isSeen(key)) return
    markSeen(key)
    if (tail.errored) {
      alert("Session error", tail.errorMessage.ifEmpty { title.ifEmpty { "Something went wrong" } }, sessionId, connectionId, sessionId.hashCode())
    } else {
      alert("Task completed", title.ifEmpty { "Session finished processing" }, sessionId, connectionId, sessionId.hashCode())
    }
  }

  private data class Prompt(val id: String, val title: String, val body: String)

  private fun pendingPrompts(base: String, api: String, auth: String?, sessionId: String): List<Prompt>? {
    return try {
      if (api == "v1") {
        val out = mutableListOf<Prompt>()
        getJson("$base/permission", auth)?.optJSONArrayOrArray()?.let { arr ->
          for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            if (row.optString("sessionID") != sessionId) continue
            val id = row.optString("id")
            if (id.isEmpty()) continue
            out.add(Prompt(id, "Agent needs approval", "A tool needs your approval"))
          }
        } ?: return null
        getJson("$base/question", auth)?.optJSONArrayOrArray()?.let { arr ->
          for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            if (row.optString("sessionID") != sessionId) continue
            val id = row.optString("id")
            if (id.isEmpty()) continue
            out.add(Prompt(id, "Input needed", "The assistant has a question"))
          }
        } ?: return null
        out
      } else {
        val out = mutableListOf<Prompt>()
        val perms = getJson("$base/api/session/$sessionId/permission", auth)?.optJSONArray("data") ?: return null
        for (i in 0 until perms.length()) {
          val row = perms.optJSONObject(i) ?: continue
          val id = row.optString("id")
          if (id.isEmpty()) continue
          val action = row.optString("action", "A tool needs your approval")
          val resources = row.optJSONArray("resources")?.let { arr ->
            (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }
          } ?: emptyList()
          val body = if (resources.isNotEmpty()) "$action: ${resources.joinToString(", ")}" else action
          out.add(Prompt(id, "Agent needs approval", body.take(200)))
        }
        val forms = getJson("$base/api/session/$sessionId/form", auth)?.optJSONArray("data") ?: return null
        for (i in 0 until forms.length()) {
          val row = forms.optJSONObject(i) ?: continue
          val id = row.optString("id")
          if (id.isEmpty()) continue
          out.add(Prompt(id, row.optString("title", "Input needed").ifEmpty { "Input needed" }, "The assistant has a question"))
        }
        out
      }
    } catch (_: Exception) {
      null
    }
  }

  private data class Tail(val terminal: Boolean, val errored: Boolean, val errorMessage: String, val deleted: Boolean)

  private fun messageTail(base: String, api: String, auth: String?, sessionId: String): Tail? {
    return try {
      if (api == "v1") {
        // Bare array, oldest-first (matches the app's store convention).
        val arr = getJson("$base/session/$sessionId/message?limit=3", auth)?.optJSONArrayOrArray() ?: return null
        if (arr.length() == 0) return Tail(false, false, "", false)
        val last = arr.optJSONObject(arr.length() - 1) ?: return Tail(false, false, "", false)
        val info = last.optJSONObject("info") ?: last
        val completed = info.optJSONObject("time")?.has("completed") == true
        val err = info.optJSONObject("error")?.optString("message", "") ?: ""
        Tail(info.optString("role") == "assistant" && (completed || err.isNotEmpty()), err.isNotEmpty(), err, false)
      } else {
        // Envelope {data:[...]}, newest-first (order=desc).
        val body = getJson("$base/api/session/$sessionId/message?order=desc&limit=3", auth) ?: return null
        val arr = body.optJSONArray("data") ?: return null
        if (arr.length() == 0) return Tail(false, false, "", false)
        val first = arr.optJSONObject(0) ?: return Tail(false, false, "", false)
        val completed = first.optJSONObject("time")?.has("completed") == true
        val err = first.optJSONObject("error")?.optString("message", "") ?: ""
        Tail(first.optString("type") == "assistant" && (completed || err.isNotEmpty()), err.isNotEmpty(), err, false)
      }
    } catch (err: HttpGone) {
      Tail(false, false, "", true)
    } catch (_: Exception) {
      null
    }
  }

  private class HttpGone : Exception()

  private fun getJson(url: String, auth: String?): JSONObject? {
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "GET"
      conn.setRequestProperty("Accept", "application/json")
      if (auth != null) conn.setRequestProperty("Authorization", auth)
      conn.connectTimeout = 15_000
      conn.readTimeout = 15_000
      val code = conn.responseCode
      if (code == 404) throw HttpGone()
      if (code !in 200..299) throw Exception("HTTP $code")
      val text = conn.inputStream.bufferedReader().readText()
      val trimmed = text.trim()
      // v1 endpoints answer bare arrays; wrap so callers share one shape.
      return if (trimmed.startsWith("[")) JSONObject().put("__array", JSONArray(trimmed)) else JSONObject(trimmed)
    } finally {
      conn.disconnect()
    }
  }

  private fun JSONObject.optJSONArrayOrArray(): JSONArray? {
    return if (has("__array")) optJSONArray("__array") else null
  }

  private fun isSeen(key: String): Boolean {
    return prefs().getString("seen_json", null)?.let {
      try {
        JSONObject(it).has(key)
      } catch (_: Exception) {
        false
      }
    } ?: false
  }

  private fun markSeen(key: String) {
    val prefs = prefs()
    val obj = try {
      JSONObject(prefs.getString("seen_json", null) ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }
    obj.put(key, 1)
    // Bound the store: drop arbitrary oldest entries past the cap. JSONObject
    // keeps insertion order, so rebuild without the first keys.
    val keys = obj.keys().asSequence().toList()
    if (keys.size > 500) {
      val trimmed = JSONObject()
      for (k in keys.takeLast(500)) trimmed.put(k, 1)
      prefs.edit().putString("seen_json", trimmed.toString()).apply()
    } else {
      prefs.edit().putString("seen_json", obj.toString()).apply()
    }
  }

  private fun prefs() = getSharedPreferences("oc_monitor_seen", Context.MODE_PRIVATE)

  private fun alert(title: String, body: String, sessionId: String, connectionId: String, requestCode: Int) {
    val deepLink = Uri.parse("opencode://session/$sessionId?connectionId=$connectionId")
    val tap = PendingIntent.getActivity(
      this, requestCode,
      Intent(this, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = deepLink
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val note = NotificationCompat.Builder(this, ALERTS_CHANNEL)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setAutoCancel(true)
      .setContentIntent(tap)
      .build()
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .notify(requestCode, note)
  }
}
