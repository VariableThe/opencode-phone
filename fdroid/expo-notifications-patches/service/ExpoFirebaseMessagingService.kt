package expo.modules.notifications.service

import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * Stub ExpoFirebaseMessagingService (Firebase-free) for F-Droid builds.
 * FCM messaging is not available in this build — extends Service (not FirebaseMessagingService).
 * Referenced in AndroidManifest.xml but never actually used without Firebase.
 */
open class ExpoFirebaseMessagingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null
}
