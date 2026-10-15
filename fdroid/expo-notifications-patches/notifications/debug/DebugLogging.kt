package expo.modules.notifications.notifications.debug

import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.annotation.RequiresApi
import expo.modules.notifications.BuildConfig
import expo.modules.notifications.notifications.model.Notification
import java.util.function.Consumer

/**
 * Patched version (Firebase-free) for F-Droid builds.
 * logRemoteMessage() removed — no Firebase classes referenced.
 */
object DebugLogging {
  @JvmStatic
  fun logBundle(caller: String, bundleToLog: Bundle) {
    if (!BuildConfig.DEBUG) {
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      return
    }
    Log.i("expo-notifications", "$caller:\n${bundleString(caller, bundleToLog, 0)}")
  }

  @RequiresApi(Build.VERSION_CODES.N)
  private fun bundleString(ignoredCaller: String, bundleToLog: Bundle, indent: Int): String {
    return buildString {
      bundleToLog.keySet().forEach(
        Consumer { key: String ->
          val value = bundleToLog[key]
          if (value is Bundle) {
            append("${" ".repeat(indent)}${key}\n")
            append(bundleString(ignoredCaller, value, indent + 2))
          } else {
            val stringValue = value?.toString() ?: "(null)"
            append("${" ".repeat(indent)}$key: $stringValue\n")
          }
        }
      )
    }
  }

  fun logNotification(caller: String, notification: Notification) {
    if (!BuildConfig.DEBUG) {
      return
    }
    val logMessage =
      """
      $caller:
        notification.notificationRequest.content.title: ${notification.notificationRequest.content.title}
        notification.notificationRequest.content.subText: ${notification.notificationRequest.content.subText}
        notification.notificationRequest.content.text: ${notification.notificationRequest.content.text}
        notification.notificationRequest.content.sound: ${notification.notificationRequest.content.soundName}
        notification.notificationRequest.content.channelID: ${notification.notificationRequest.trigger.getNotificationChannel()}
        notification.notificationRequest.content.body: ${notification.notificationRequest.content.body}
        notification.notificationRequest.content.color: ${notification.notificationRequest.content.color}
        notification.notificationRequest.content.vibrationPattern: ${notification.notificationRequest.content.vibrationPattern?.contentToString()}
        notification.notificationRequest.identifier: ${notification.notificationRequest.identifier}
      """.trimIndent()

    Log.i("expo-notifications", logMessage)
  }
}
