package expo.modules.notifications.tokens

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.notifications.service.delegates.FirebaseMessagingDelegate.Companion.addTokenListener
import expo.modules.notifications.tokens.interfaces.FirebaseTokenListener

private const val NEW_TOKEN_EVENT_NAME = "onDevicePushToken"
private const val NEW_TOKEN_EVENT_TOKEN_KEY = "devicePushToken"
private const val REGISTRATION_FAIL_CODE = "E_REGISTRATION_FAILED"
private const val UNREGISTER_FOR_NOTIFICATIONS_FAIL_CODE = "E_UNREGISTER_FOR_NOTIFICATIONS_FAILED"

/**
 * Stub PushTokenModule (Firebase-free) for F-Droid builds.
 * Push tokens are unavailable without Firebase — getDevicePushTokenAsync rejects with an error.
 */
class PushTokenModule : Module(), FirebaseTokenListener {
  override fun onNewToken(token: String) {
    runCatching {
      sendEvent(NEW_TOKEN_EVENT_NAME, mapOf(NEW_TOKEN_EVENT_TOKEN_KEY to token))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoPushTokenManager")

    Events("onDevicePushToken")

    OnCreate {
      addTokenListener(this@PushTokenModule)
    }

    AsyncFunction("getDevicePushTokenAsync") { promise: Promise ->
      promise.reject(REGISTRATION_FAIL_CODE, "Push notifications via FCM are not available in this build (F-Droid). Use local notifications only.", null)
    }

    AsyncFunction("unregisterForNotificationsAsync") { promise: Promise ->
      promise.resolve(null)
    }
  }
}
