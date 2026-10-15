package expo.modules.notifications.service.delegates

import android.content.Context
import android.os.Bundle
import expo.modules.notifications.notifications.background.BackgroundRemoteNotificationTaskConsumer
import expo.modules.notifications.tokens.interfaces.FirebaseTokenListener
import java.lang.ref.WeakReference
import java.util.*

/**
 * Stub implementation (Firebase-free) for F-Droid builds.
 * This app only uses local notifications - no FCM push tokens or remote messages.
 * Does NOT implement the interfaces.FirebaseMessagingDelegate interface to avoid
 * unresolved reference errors (the interface stub is only needed for FirebaseTokenListener).
 */
open class FirebaseMessagingDelegate(protected val context: Context) {

  companion object {
    protected var sLastToken: String? = null
    protected val sTokenListenersReferences = WeakHashMap<FirebaseTokenListener, WeakReference<FirebaseTokenListener?>?>()
    protected var sBackgroundTaskConsumerReferences = WeakHashMap<BackgroundRemoteNotificationTaskConsumer, WeakReference<BackgroundRemoteNotificationTaskConsumer>>()

    @JvmStatic
    fun addTokenListener(listener: FirebaseTokenListener) {
      if (!sTokenListenersReferences.containsKey(listener)) {
        sTokenListenersReferences[listener] = WeakReference(listener)
        sLastToken?.let { listener.onNewToken(it) }
      }
    }

    fun addBackgroundTaskConsumer(taskConsumer: BackgroundRemoteNotificationTaskConsumer) {
      if (!sBackgroundTaskConsumerReferences.containsKey(taskConsumer)) {
        sBackgroundTaskConsumerReferences[taskConsumer] = WeakReference(taskConsumer)
      }
    }

    fun getBackgroundTasks() = sBackgroundTaskConsumerReferences.values.mapNotNull { it.get() }

    /** No-op for F-Droid builds (no FCM, local notifications only). */
    fun runTaskManagerTasks(applicationContext: Context, bundle: Bundle) {
      // no-op: no FCM in this build
    }
  }

  fun onNewToken(token: String) {
    for (listenerReference in sTokenListenersReferences.values) {
      listenerReference?.get()?.onNewToken(token)
    }
    sLastToken = token
  }

  fun onDeletedMessages() {
    // no-op
  }
}
