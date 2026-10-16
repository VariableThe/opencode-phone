package cc.agentlabs.opencode

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

// JS bridge for SessionMonitorService. Thin on purpose: all polling and
// notification logic lives in the service; this only (re)starts it with fresh
// config (targets JSON + interval) or stops it. Credentials travel in the
// start intent extras — in memory only, never written to disk by the service
// (a reboot therefore requires reopening the app, which re-sends them).
@ReactModule(name = SessionMonitorModule.NAME)
class SessionMonitorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "SessionMonitor"
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun start(config: ReadableMap, promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, SessionMonitorService::class.java).apply {
        action = SessionMonitorService.ACTION_START
        putExtra(SessionMonitorService.EXTRA_TARGETS, config.getString("targets") ?: "[]")
        putExtra(SessionMonitorService.EXTRA_INTERVAL_SEC, config.getInt("intervalSec"))
      }
      ContextCompat.startForegroundService(reactApplicationContext, intent)
      promise.resolve(true)
    } catch (err: Exception) {
      promise.reject("START_FAILED", err.message, err)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, SessionMonitorService::class.java).apply {
        action = SessionMonitorService.ACTION_STOP
      }
      reactApplicationContext.startService(intent)
      promise.resolve(true)
    } catch (err: Exception) {
      promise.reject("STOP_FAILED", err.message, err)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(SessionMonitorService.running.get())
  }
}
